/**
 * The visit watch (docs/specs/0097): hourly reads of NEMO's formality list for
 * every open port call in NEMO; a visit NEMO cancelled is unlinked here and
 * the organisation's admins are told once. Reads only — nothing goes to NEMO.
 */
import type { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import { visitCancelledIn } from '../src/canonical/visit-unlink';
import { VisitWatchService, WATCH_ACTOR } from '../src/nemo-watch/visit-watch.service';
import { NemoApiError, type NemoClientService } from '../src/nemo-client/nemo-client.service';
import type { NotifyService } from '../src/notify/notify.service';
import type { TenantDb } from '../src/tenancy/tenant-db';

const CANCELLED = [
  { formalityType: 'VID', status: 'INVALIDATED' },
  { formalityType: 'COA', status: 'SUBMITTED' },
];
const LIVE = [{ formalityType: 'VID', status: 'SUBMITTED' }, { formalityType: 'NOA', status: 'SUBMITTED' }];

const row = (id: string, visit: string) => ({
  id, visit_id: visit, ship_id: 'ship-1', ship_name: 'BLACK PEARL', port_locode: 'FIRAU', eta: '2026-10-07T13:00:00Z',
});

function harness(opts: {
  calls?: Record<string, unknown>[];
  formalities?: (orgSlug: string, visitId: string) => Promise<unknown>;
  target?: string;
  emailEnabled?: boolean;
  admins?: string[];
} = {}) {
  const sql: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (q: string, params?: unknown[]) => {
      sql.push({ sql: q, params });
      if (q.includes('FROM port_call pc')) return { rows: opts.calls ?? [row('pc-1', 'FI20261006-034-4'), row('pc-2', 'FI20261006-040-1')] };
      return { rowCount: 1, rows: [] };
    }),
  } as unknown as PoolClient;
  const tenantDb = {
    activeOrgs: jest.fn(async () => [{ slug: 'fleetco', schema: 'org_fleetco' }]),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
  } as unknown as TenantDb;
  const getFormalities = jest.fn(opts.formalities ?? (async (_org: string, v: string) => (v === 'FI20261006-034-4' ? CANCELLED : LIVE)));
  const nemo = { target: opts.target ?? 'stg', getFormalities, createFormality: jest.fn(), updateFormality: jest.fn() };
  const content = jest.fn(async () => 'audit-1');
  const sendTracked = jest.fn(async () => ({ emailMessageId: 'm-1', status: 'sent' }));
  const notify = { emailEnabled: opts.emailEnabled ?? true, sendTracked } as unknown as NotifyService;
  const pool = { query: jest.fn(async () => ({ rows: (opts.admins ?? ['admin@example.com']).map((email) => ({ email })) })) } as unknown as Pool;
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;
  const service = new VisitWatchService(pool, tenantDb, nemo as unknown as NemoClientService, { content } as unknown as AuditService, notify, config);
  return { service, sql, nemo, content, sendTracked, pool };
}

describe('visit watch (spec 0097)', () => {
  it('unlinks the visit NEMO cancelled, leaves the live one, tells the admins once', async () => {
    const h = harness();
    const run = await h.service.run();
    expect(run).toMatchObject({ orgs: 1, checked: 2, skipped: [] });
    expect(run.unlinked.map((c) => c.visitId)).toEqual(['FI20261006-034-4']);
    const unlink = h.sql.filter((x) => x.sql.includes('visit_id = NULL'));
    expect(unlink).toHaveLength(1);
    expect(unlink[0]!.params![0]).toBe('pc-1');
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: WATCH_ACTOR, data: expect.objectContaining({ action: 'nemo_visit_unlinked', visitId: 'FI20261006-034-4' }) }),
      expect.anything(),
    );
    expect(h.sendTracked).toHaveBeenCalledTimes(1);
    expect(h.sendTracked).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@example.com',
      subject: 'NEMOLink: NEMO cancelled FI20261006-034-4 (BLACK PEARL · FIRAU)',
      template: 'nemo-visit-cancelled',
    }));
  });

  it('reads only: nothing is ever sent to NEMO', async () => {
    const h = harness();
    await h.service.run();
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.nemo.updateFormality).not.toHaveBeenCalled();
  });

  it('a visit NEMO does not know (404) is unlinked too', async () => {
    const h = harness({ calls: [row('pc-1', 'FI20261006-099-9')], formalities: async () => { throw new NemoApiError(404, ''); } });
    const run = await h.service.run();
    expect(run.unlinked).toEqual([expect.objectContaining({ visitId: 'FI20261006-099-9', reason: expect.stringMatching(/404/) })]);
  });

  it('a 400 (how NEMO answers an unknown visit id) is not proof: left linked, the round goes on', async () => {
    const h = harness({ formalities: async (_o: string, v: string) => { if (v === 'FI20261006-034-4') throw new NemoApiError(400, '{"errorKey":"BAD_REQUEST"}'); return LIVE; } });
    const run = await h.service.run();
    expect(run).toMatchObject({ checked: 2, unlinked: [], skipped: [] });
    expect(h.sql.some((x) => x.sql.includes('visit_id = NULL'))).toBe(false);
  });

  it('NEMO not reached: that organisation stops quietly, nothing unlinked, nobody emailed', async () => {
    const h = harness({ formalities: async () => { throw new NemoApiError(503, ''); } });
    const run = await h.service.run();
    expect(run.unlinked).toEqual([]);
    expect(run.skipped).toEqual([expect.objectContaining({ org: 'fleetco' })]);
    expect(h.nemo.getFormalities).toHaveBeenCalledTimes(1);
    expect(h.sendTracked).not.toHaveBeenCalled();
  });

  it('nothing to tell when every visit is alive; the mock target is skipped', async () => {
    const live = harness({ formalities: async () => LIVE });
    expect((await live.service.run()).unlinked).toEqual([]);
    expect(live.sendTracked).not.toHaveBeenCalled();
    const mock = harness({ target: 'mock' });
    expect(await mock.service.run()).toEqual({ orgs: 0, checked: 0, unlinked: [], skipped: [] });
    expect(mock.nemo.getFormalities).not.toHaveBeenCalled();
  });

  it('email disabled: the unlink still happens, the warning is logged', async () => {
    const h = harness({ emailEnabled: false });
    const run = await h.service.run();
    expect(run.unlinked).toHaveLength(1);
    expect(h.sendTracked).not.toHaveBeenCalled();
  });

  it('visitCancelledIn reads the live list shapes', () => {
    expect(visitCancelledIn(CANCELLED)).toBe(true);
    expect(visitCancelledIn(LIVE)).toBe(false);
  });
});
