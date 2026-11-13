/**
 * The status light and the NEMO alive check (spec 0082).
 */
import type { Pool } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import { NemoApiError, type NemoClientService } from '../src/nemo-client/nemo-client.service';
import { StatusService, worst } from '../src/status/status.service';
import type { TenantDb } from '../src/tenancy/tenant-db';

const H = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

interface Rows {
  alive?: { at: Date; status: string; stats: Record<string, unknown> } | null;
  used?: { at: Date; data: Record<string, unknown> } | null;
  creds?: string[];
  received?: { source_system: string; at: Date }[];
  worker?: Date | null;
  lists?: { job: string; status: string; stats: Record<string, unknown>; at: Date }[];
  key?: string | null;
}

function harness(rows: Rows, target: 'stg' | 'mock' = 'stg', getPortCalls?: jest.Mock) {
  const sql: { text: string; params?: unknown[] }[] = [];
  const query = jest.fn(async (text: string, params?: unknown[]) => {
    sql.push({ text, params });
    if (text.includes("job = 'nemo_alive' AND status")) return { rows: rows.alive ? [rows.alive] : [] };
    if (text.includes("entity_type = 'nemo_submission'")) return { rows: rows.used ? [rows.used] : [] };
    if (text.includes('FROM platform.ingest_credential')) return { rows: (rows.creds ?? []).map((s) => ({ source_system: s })) };
    if (text.includes("author = 'worker'")) return { rows: [{ at: rows.worker ?? null }] };
    if (text.includes('DISTINCT ON (job)')) return { rows: rows.lists ?? [] };
    if (text.includes('FROM platform.nemo_credential')) return { rows: rows.key === null ? [] : [{ slug: rows.key ?? 'fleetco' }] };
    if (text.includes('INSERT INTO platform.sync_run')) return { rows: [{ id: 'run-1' }] };
    return { rows: [] };
  });
  const tenantDb = {
    withOrg: jest.fn(async (_s: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({ query: jest.fn(async () => ({ rows: rows.received ?? [] })) }),
    ),
  } as unknown as TenantDb;
  const content = jest.fn(async () => 'audit-1');
  const nemo = { target, getPortCalls: getPortCalls ?? jest.fn(async () => []) } as unknown as NemoClientService;
  const service = new StatusService({ query } as unknown as Pool, tenantDb, nemo, { content } as unknown as AuditService);
  return { service, sql, content };
}

const FRESH_LISTS = [{ job: 'schemas', status: 'ok', stats: {}, at: ago(H) }];

describe('status light (spec 0082)', () => {
  it('worst of the parts', () => {
    expect(worst(['green', 'yellow', 'green'])).toBe('yellow');
    expect(worst(['green', 'red', 'yellow'])).toBe('red');
    expect(worst([])).toBe('green');
  });

  it('all well: green, no integrations line without an ingest credential', async () => {
    const h = harness({ alive: { at: ago(10 * 60000), status: 'ok', stats: { httpStatus: 200 } }, worker: ago(H), lists: FRESH_LISTS });
    const s = await h.service.status('fleetco');
    expect(s.light).toBe('green');
    expect(s.items.map((i) => i.key)).toEqual(['nemo', 'system', 'lists']);
    expect(s.items[0]!.words).toMatch(/^NEMO answered 10 min ago/);
  });

  it('the latest word wins: a send that got 503 after a good check is red, "NEMO is down currently"', async () => {
    const h = harness({
      alive: { at: ago(40 * 60000), status: 'ok', stats: { httpStatus: 200 } },
      used: { at: ago(5 * 60000), data: { status: 'error', httpStatus: 503 } },
      worker: ago(H),
      lists: FRESH_LISTS,
    });
    const s = await h.service.status('fleetco');
    expect(s.light).toBe('red');
    expect(s.items[0]).toMatchObject({ key: 'nemo', light: 'red' });
    expect(s.items[0]!.words).toMatch(/NEMO is down currently — a send 5 min ago got 503 Service Unavailable/);
  });

  it('a 400 from NEMO proves it is up', async () => {
    const h = harness({ used: { at: ago(60000), data: { status: 'error', httpStatus: 400 } }, worker: ago(H), lists: FRESH_LISTS });
    expect((await h.service.status(null)).items[0]!.light).toBe('green');
  });

  it('integrations: > 2 h yellow, > 12 h red, never received red', async () => {
    const at = (h: number) => harness({
      alive: { at: ago(60000), status: 'ok', stats: {} },
      creds: ['opsdesk'],
      received: [{ source_system: 'opsdesk', at: ago(h * H) }],
      worker: ago(H),
      lists: FRESH_LISTS,
    });
    expect((await at(1).service.status('acmeship')).items[1]).toMatchObject({ key: 'integrations', light: 'green' });
    expect((await at(3).service.status('acmeship')).items[1]).toMatchObject({ light: 'yellow', words: 'opsdesk: last data 3 h ago' });
    expect((await at(13).service.status('acmeship')).items[1]!.light).toBe('red');
    const never = harness({ creds: ['opsdesk'], received: [], worker: ago(H), lists: FRESH_LISTS });
    expect((await never.service.status('acmeship')).items[1]).toMatchObject({ light: 'red', words: 'opsdesk: no data received yet' });
  });

  it('lists: upstream contract drift or a failed run is yellow', async () => {
    const h = harness({
      alive: { at: ago(60000), status: 'ok', stats: {} },
      worker: ago(H),
      lists: [
        { job: 'schemas', status: 'ok', stats: { changed: ['a', 'b'] }, at: ago(H) },
        { job: 'ships', status: 'failed', stats: {}, at: ago(H) },
      ],
    });
    const lists = (await h.service.status(null)).items.find((i) => i.key === 'lists')!;
    expect(lists.light).toBe('yellow');
    expect(lists.words).toBe('NEMO changed 2 contract file(s) upstream — adoption needed · last run failed: ships');
  });

  it('a worker that has not run for a day and more is yellow', async () => {
    const h = harness({ alive: { at: ago(60000), status: 'ok', stats: {} }, worker: ago(30 * H), lists: FRESH_LISTS });
    expect((await h.service.status(null)).items.find((i) => i.key === 'system')!.light).toBe('yellow');
  });
});

describe('the NEMO alive check (spec 0082)', () => {
  it('reads the port call list with an org key, records a tracked run and a short audit line', async () => {
    const getPortCalls = jest.fn(async () => []);
    const h = harness({}, 'stg', getPortCalls);
    await expect(h.service.aliveCheck()).resolves.toMatchObject({ ok: true, httpStatus: 200 });
    expect(getPortCalls).toHaveBeenCalledWith('fleetco', expect.objectContaining({ timeWindowStart: expect.any(String) }));
    const update = h.sql.find((q) => q.text.includes('UPDATE platform.sync_run'))!;
    expect(update.params![1]).toBe('ok');
    expect(h.content).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'nemo_alive_check', ok: true }) }));
  });

  it('NEMO down (sign-in 503): a failed run with the words', async () => {
    const h = harness({}, 'stg', jest.fn().mockRejectedValue(new NemoApiError(503, '', 'token endpoint responded 503', 'token')));
    await expect(h.service.aliveCheck()).resolves.toMatchObject({ ok: false, httpStatus: 503 });
    const update = h.sql.find((q) => q.text.includes('UPDATE platform.sync_run'))!;
    expect(update.params![1]).toBe('failed');
    expect(String(update.params![3])).toMatch(/^503 Service Unavailable: NEMO is unavailable/);
  });

  it('skipped on the mock target and without any key', async () => {
    await expect(harness({}, 'mock').service.aliveCheck()).resolves.toBeNull();
    await expect(harness({ key: null }).service.aliveCheck()).resolves.toBeNull();
  });
});
