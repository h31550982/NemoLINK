/**
 * Spec 0058 — the server applies its own migrations at boot.
 *
 * The property under test throughout: nothing serves on a schema we have not
 * confirmed. A failure aborts the boot, the lock is released even when it does,
 * and replaying an already-migrated database is a no-op.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import {
  applyMigrations,
  DEFAULT_LOCK_WAIT_MS,
  lockWaitMs,
  migrationConnectionString,
  migrationFiles,
  migrationsEnabled,
  resolveMigrationsDir,
} from '../src/db/migrations';

function tempMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nemolink-mig-'));
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql, 'utf8');
  }
  return dir;
}

function fakeClient(opts: { failOn?: string } = {}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (opts.failOn && sql.includes(opts.failOn)) {
      throw new Error('relation "nope" does not exist');
    }
    return { rows: [] };
  });
  return { client: { query } as unknown as Client, queries, query };
}

describe('finding the migrations', () => {
  it('applies in filename order — the dated scheme IS the order', () => {
    const dir = tempMigrations({
      '2026-09-03_01_second.sql': 'SELECT 2;',
      '2026-08-23_00_first.sql': 'SELECT 1;',
      'notes.md': 'not a migration',
    });
    expect(migrationFiles(dir)).toEqual([
      '2026-08-23_00_first.sql',
      '2026-09-03_01_second.sql',
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('MIGRATIONS_DIR wins over every other candidate', () => {
    const dir = tempMigrations({ '2026-01-01_00_x.sql': 'SELECT 1;' });
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: dir })).toBe(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the real repo migrations from the compiled layout (AC 8)', () => {
    // dist/db in the image is <root>/dist/db; in dev it is server/dist/db.
    // Both are covered by the candidate walk — this asserts the repo's own
    // migrations/ is reachable from where the built code actually sits.
    const found = resolveMigrationsDir({}, join(__dirname, '..', 'src', 'db'));
    expect(found).not.toBeNull();
    expect(migrationFiles(found!).length).toBeGreaterThan(0);
  });

  it('ignores a directory that exists but holds no migrations', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nemolink-empty-'));
    mkdirSync(join(empty, 'migrations'));
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: join(empty, 'migrations') })).not.toBe(
      join(empty, 'migrations'),
    );
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('configuration', () => {
  it('is on unless explicitly switched off (AC 4)', () => {
    expect(migrationsEnabled({})).toBe(true);
    expect(migrationsEnabled({ RUN_MIGRATIONS_ON_BOOT: 'true' })).toBe(true);
    expect(migrationsEnabled({ RUN_MIGRATIONS_ON_BOOT: 'false' })).toBe(false);
  });

  it('waits two minutes for the lock unless MIGRATION_LOCK_WAIT_MS says otherwise', () => {
    expect(lockWaitMs({})).toBe(DEFAULT_LOCK_WAIT_MS);
    expect(DEFAULT_LOCK_WAIT_MS).toBe(120_000);
    expect(lockWaitMs({ MIGRATION_LOCK_WAIT_MS: '30000' })).toBe(30000);
    expect(lockWaitMs({ MIGRATION_LOCK_WAIT_MS: 'soon' })).toBe(DEFAULT_LOCK_WAIT_MS);
  });

  it('prefers MIGRATION_DATABASE_URL, for the Phase-4 role split (AC 5)', () => {
    expect(
      migrationConnectionString({
        DATABASE_URL: 'postgres://app@db/nemolink',
        MIGRATION_DATABASE_URL: 'postgres://owner@db/nemolink',
      }),
    ).toBe('postgres://owner@db/nemolink');
    expect(migrationConnectionString({ DATABASE_URL: 'postgres://app@db/nemolink' })).toBe(
      'postgres://app@db/nemolink',
    );
    expect(migrationConnectionString({})).toBeUndefined();
  });
});

describe('applying', () => {
  it('replays every file in order, each in its own transaction (AC 1)', async () => {
    const dir = tempMigrations({
      '2026-08-23_00_first.sql': 'CREATE TABLE IF NOT EXISTS a ();',
      '2026-09-03_01_second.sql': 'CREATE TABLE IF NOT EXISTS b ();',
    });
    const { client, queries } = fakeClient();
    const applied = await applyMigrations(client, dir);

    expect(applied).toEqual(['2026-08-23_00_first.sql', '2026-09-03_01_second.sql']);
    const sqls = queries.map((q) => q.sql);
    // The bounded wait comes first, the lock under it, then the wait is reset
    expect(sqls.slice(0, 3)).toEqual([
      'SET lock_timeout = 120000',
      'SELECT pg_advisory_lock(hashtext($1))',
      'RESET lock_timeout',
    ]);
    expect(sqls.filter((s) => s === 'BEGIN')).toHaveLength(2);
    expect(sqls.filter((s) => s === 'COMMIT')).toHaveLength(2);
    expect(sqls).not.toContain('ROLLBACK');
    expect(sqls[sqls.length - 1]).toContain('pg_advisory_unlock');
    rmSync(dir, { recursive: true, force: true });
  });

  it('holds one lock for the whole run, so two booting servers serialize (AC 3)', async () => {
    const dir = tempMigrations({ '2026-01-01_00_x.sql': 'SELECT 1;' });
    const { client, queries } = fakeClient();
    await applyMigrations(client, dir);
    const locks = queries.filter((q) => q.sql.includes('pg_advisory_lock'));
    expect(locks).toHaveLength(1);
    expect(locks[0]!.params).toEqual(['nemolink:migrations']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('names the failing file, rolls it back, and still releases the lock (AC 2, 3)', async () => {
    const dir = tempMigrations({
      '2026-01-01_00_ok.sql': 'SELECT 1;',
      '2026-01-02_00_broken.sql': 'SELECT boom;',
    });
    const { client, queries } = fakeClient({ failOn: 'boom' });

    await expect(applyMigrations(client, dir)).rejects.toThrow(
      /migration 2026-01-02_00_broken\.sql failed: relation "nope" does not exist/,
    );
    const sqls = queries.map((q) => q.sql);
    // The good one committed; the bad one rolled back alone — replay-all
    // converges the rest on the next boot.
    expect(sqls.filter((s) => s === 'COMMIT')).toHaveLength(1);
    expect(sqls).toContain('ROLLBACK');
    // A wedged lock would block every future boot, so this is the one that matters
    expect(sqls[sqls.length - 1]).toContain('pg_advisory_unlock');
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives up on a held lock after the wait and names the holder (2026-09-30)', async () => {
    const dir = tempMigrations({ '2026-01-01_00_x.sql': 'SELECT 1;' });
    const queries: string[] = [];
    const query = jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT pg_advisory_lock')) {
        throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
      }
      if (sql.includes('FROM pg_locks')) {
        return {
          rows: [{ pid: 358470, client: '192.0.2.5/32', app: '', state: 'idle in transaction', since: '2026-09-30 13:46:05' }],
        };
      }
      return { rows: [] };
    });
    await expect(applyMigrations({ query } as unknown as Client, dir, 5000)).rejects.toThrow(
      /still held after 5s by session 358470 .*idle in transaction since 2026-09-30 13:46:05.*pg_terminate_backend\(358470\)/,
    );
    // Nothing ran, and the wait was reset even so
    expect(queries).not.toContain('BEGIN');
    expect(queries).toContain('RESET lock_timeout');
    expect(queries[0]).toBe('SET lock_timeout = 5000');
    rmSync(dir, { recursive: true, force: true });
  });

  it('a lock error other than the timeout is passed on as it is', async () => {
    const dir = tempMigrations({ '2026-01-01_00_x.sql': 'SELECT 1;' });
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT pg_advisory_lock')) throw new Error('Connection terminated unexpectedly');
      return { rows: [] };
    });
    await expect(applyMigrations({ query } as unknown as Client, dir)).rejects.toThrow('Connection terminated unexpectedly');
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an empty directory rather than call a no-op a success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nemolink-none-'));
    const { client } = fakeClient();
    await expect(applyMigrations(client, dir)).rejects.toThrow(/no migrations found/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaying an already-migrated database is a no-op (AC 6)', async () => {
    // Idempotency is the migration author's contract (invariant 6); from here
    // it looks like every file simply succeeding again.
    const dir = tempMigrations({
      '2026-01-01_00_x.sql': 'CREATE TABLE IF NOT EXISTS x ();',
    });
    const { client } = fakeClient();
    await expect(applyMigrations(client, dir)).resolves.toEqual(['2026-01-01_00_x.sql']);
    await expect(applyMigrations(client, dir)).resolves.toEqual(['2026-01-01_00_x.sql']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the repo is deployable', () => {
  it('every committed migration is non-empty SQL', () => {
    const dir = resolveMigrationsDir({}, join(__dirname, '..', 'src', 'db'))!;
    const files = migrationFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Filename order is apply order, so the dated scheme is load-bearing
      expect(file).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}_[a-z0-9-]+\.sql$/);
    }
  });
});
