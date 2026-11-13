/**
 * Migrations at boot (spec 0058).
 *
 * The failure this exists to stop: `schema.sql` is mounted into the db
 * container's /docker-entrypoint-initdb.d/, but Postgres runs that directory
 * ONLY when the data volume is empty — and the volume is a bind mount that
 * survives everything. So rebuilding the container never re-applies it, and a
 * new image against an old schema starts happily, then fails at the first query
 * touching a column that was never added. Nothing warns.
 *
 * Replay-all, not a bookkeeping table (spec 0022, invariant 6): every migration
 * is idempotent, so replaying every file converges any environment — including
 * one half-migrated by hand or restored from a mid-deploy backup. A bookkeeping
 * table records what we think happened; replay records what is.
 *
 * Deliberately a plain function, not a Nest provider: it runs before the DI
 * graph exists, because nothing should be constructed against a schema we have
 * not confirmed yet.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

/** One lock for the whole run, so two booting servers serialize. */
const LOCK_KEY = 'nemolink:migrations';

/**
 * How long a boot waits for the lock before it gives up and says who holds
 * it (2026-09-30: a VPN drop mid-run left the server side of the session
 * alive, idle in its transaction, holding the lock — and every later boot
 * waited on it silently). MIGRATION_LOCK_WAIT_MS overrides.
 */
export const DEFAULT_LOCK_WAIT_MS = 120_000;

/**
 * The migration session asks the server to end it when it sits idle this
 * long, so a boot that died mid-run frees the lock within a minute instead
 * of whenever the server's TCP keepalive notices (hours).
 */
export const ORPHAN_TIMEOUT = '60s';

export function lockWaitMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env['MIGRATION_LOCK_WAIT_MS']);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LOCK_WAIT_MS;
}

export interface MigrationRun {
  /** Files replayed, in the order they were applied. */
  applied: string[];
  directory: string;
  ms: number;
}

/**
 * Where the .sql files are, in both layouts we actually run in: `nest start`
 * from `server/` (dist/db → ../../../migrations) and `node dist/main.js` from
 * `/app` in the image (cwd/migrations). MIGRATIONS_DIR overrides everything.
 */
export function resolveMigrationsDir(
  env: NodeJS.ProcessEnv = process.env,
  dirname: string = __dirname,
): string | null {
  const candidates = [
    env['MIGRATIONS_DIR'],
    join(process.cwd(), 'migrations'),
    resolve(dirname, '..', '..', 'migrations'),
    resolve(dirname, '..', '..', '..', 'migrations'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate) && migrationFiles(candidate).length > 0) {
      return candidate;
    }
  }
  return null;
}

/** Filename order IS apply order — the dated `yyyy-mm-dd_NN_topic.sql` scheme. */
export function migrationFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export function migrationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['RUN_MIGRATIONS_ON_BOOT'] !== 'false';
}

/**
 * The owner role applies DDL; the app role will not (Phase 4 role split,
 * docs/10). Setting MIGRATION_DATABASE_URL is the only change that will need.
 */
export function migrationConnectionString(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env['MIGRATION_DATABASE_URL'] || env['DATABASE_URL'] || undefined;
}

/**
 * Applies every migration in filename order under one advisory lock. Throws on
 * the first failure, naming the file — the caller aborts the boot rather than
 * serve on a schema we know is wrong.
 */
export async function applyMigrations(
  client: Pick<Client, 'query'>,
  directory: string,
  waitMs: number = DEFAULT_LOCK_WAIT_MS,
): Promise<string[]> {
  const files = migrationFiles(directory);
  if (files.length === 0) throw new Error(`no migrations found in ${directory}`);

  // The wait is bounded for the lock only; the migrations themselves keep the
  // server default, so a slow DDL is not cut short.
  await client.query(`SET lock_timeout = ${Math.trunc(waitMs)}`);
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') {
      throw new Error(await lockHolderWords(client, waitMs));
    }
    throw error;
  } finally {
    await client.query('RESET lock_timeout');
  }
  const applied: string[] = [];
  try {
    for (const file of files) {
      const sql = readFileSync(join(directory, file), 'utf8');
      // Per file, not per run: a migration that fails rolls back alone, and
      // everything before it stays applied — which replay-all then converges.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`migration ${file} failed: ${message}`);
      }
    }
    return applied;
  } finally {
    // Released even when a migration threw, so a bad deploy does not wedge the
    // next boot behind a lock nobody holds a session for any more.
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
  }
}

/**
 * Who holds the migration lock, in words the operator can act on — the
 * session, where from, since when, and how to end it if it is an orphan.
 */
async function lockHolderWords(client: Pick<Client, 'query'>, waitMs: number): Promise<string> {
  const head = `migrations: the migration lock is still held after ${Math.round(waitMs / 1000)}s`;
  try {
    const { rows } = await client.query(
      `SELECT a.pid, a.client_addr::text AS client, a.application_name AS app, a.state,
              to_char(COALESCE(a.xact_start, a.backend_start), 'YYYY-MM-DD HH24:MI:SS') AS since
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.granted AND l.objid = hashtext($1)::oid`,
      [LOCK_KEY],
    );
    const h = rows[0] as { pid: number; client: string | null; app: string; state: string; since: string } | undefined;
    if (!h) return `${head}, by a session that has since gone — start again`;
    return (
      `${head} by session ${h.pid} (${h.app || 'no name'}, from ${h.client ?? 'local'}, ` +
      `${h.state} since ${h.since}). If that is a boot whose connection dropped, end it with ` +
      `SELECT pg_terminate_backend(${h.pid}); and start again`
    );
  } catch {
    return `${head}; another session holds it (pg_locks, advisory, key ${LOCK_KEY})`;
  }
}

/** The boot entry point. Returns null when migrations are switched off. */
export async function runMigrationsOnBoot(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = (m) => console.log(m),
): Promise<MigrationRun | null> {
  if (!migrationsEnabled(env)) {
    log('migrations: RUN_MIGRATIONS_ON_BOOT=false — skipped, schema NOT verified');
    return null;
  }
  const connectionString = migrationConnectionString(env);
  if (!connectionString) throw new Error('migrations: no DATABASE_URL');

  const directory = resolveMigrationsDir(env);
  if (!directory) {
    // Not a warning: an image without its migrations is the exact deploy this
    // spec exists to prevent, and starting anyway would hide it again.
    throw new Error(
      'migrations: no migrations directory found — set MIGRATIONS_DIR, or check ' +
        'that the image was built from the nemolink root (spec 0058)',
    );
  }

  const started = Date.now();
  // Keepalive notices a dropped link from this side; the two timeouts make the
  // server end this session if it is left idle — a boot that died mid-run no
  // longer strands the lock. The name makes it findable in pg_stat_activity.
  const client = new Client({
    connectionString,
    application_name: 'nemolink-migrations',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query(`SET idle_in_transaction_session_timeout = '${ORPHAN_TIMEOUT}'`);
    await client.query(`SET idle_session_timeout = '${ORPHAN_TIMEOUT}'`);
    const applied = await applyMigrations(client, directory, lockWaitMs(env));
    const ms = Date.now() - started;
    log(`migrations: ${applied.length} file(s) replayed from ${directory} in ${ms}ms`);
    return { applied, directory, ms };
  } finally {
    await client.end();
  }
}
