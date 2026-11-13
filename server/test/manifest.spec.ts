/**
 * Spec 0055 — source manifests: how a port call deleted at its source gets
 * noticed without letting a crashed push delete live declarations.
 *
 * The whole design rests on one asymmetry: a manifest is a positive statement,
 * so absence is only meaningful inside one. These tests hold that line —
 * withheld never deactivates, touched calls are never swept, a recreated call
 * is adopted rather than duplicated, and an implausible sweep changes nothing.
 */
import type { PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import {
  ManifestService,
  REMOVAL_FLOOR,
  REMOVAL_SHARE_LIMIT,
} from '../src/canonical/manifest.service';
import { envelopeSchema, type ManifestEnvelope } from '../src/ingest/envelope.schema';

const CALL_A = '11111111-1111-4111-8111-111111111111';
const CALL_B = '22222222-2222-4222-8222-222222222222';
const CALL_C = '33333333-3333-4333-8333-333333333333';
const CALL_NEW = '44444444-4444-4444-8444-444444444444';

interface HeldRow {
  id: string;
  source_call_id: string;
  ship_id: string | null;
  port_locode: string | null;
  eta: Date | null;
  touched: boolean;
}

function heldRow(over: Partial<HeldRow> & { source_call_id: string }): HeldRow {
  return {
    id: `pc-${over.source_call_id.slice(0, 4)}`,
    ship_id: 'ship-1',
    port_locode: 'FIRAU',
    eta: new Date('2026-09-10T08:00:00Z'),
    touched: false,
    ...over,
  };
}

function manifest(
  entries: Array<{ sourceCallId: string; disposition: 'sent' | 'withheld'; reason?: string }>,
  over: Record<string, unknown> = {},
): ManifestEnvelope {
  const parsed = envelopeSchema.parse({
    sourceSystem: 'opsdesk',
    eventId: 'opsdesk-manifest-1',
    occurredAt: '2026-09-03T12:00:00Z',
    payloadType: 'manifest',
    payload: {
      scope: 'port-calls',
      windowFrom: '2026-08-04T00:00:00Z',
      windowTo: '2026-10-03T00:00:00Z',
      entries,
      ...over,
    },
  });
  if (parsed.payloadType !== 'manifest') throw new Error('not a manifest');
  return parsed;
}

interface Query {
  sql: string;
  params?: unknown[];
}

function harness(opts: { held?: HeldRow[]; candidates?: Record<string, unknown>[] } = {}) {
  const queries: Query[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('FROM port_call pc')) return { rows: opts.held ?? [] };
    if (sql.includes('FROM port_call\n        WHERE source =')) {
      return { rows: opts.candidates ?? [] };
    }
    return { rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  const content = jest.fn().mockResolvedValue('audit-1');
  const service = new ManifestService({ content } as unknown as AuditService);
  const updates = () => queries.filter((q) => q.sql.includes('UPDATE port_call'));
  return { service, client, queries, content, updates };
}

describe('manifest envelope validation', () => {
  it('rejects a withheld entry that does not say why', () => {
    const result = envelopeSchema.safeParse({
      sourceSystem: 'opsdesk',
      eventId: 'e1',
      occurredAt: '2026-09-03T12:00:00Z',
      payloadType: 'manifest',
      payload: {
        scope: 'port-calls',
        windowFrom: '2026-08-04T00:00:00Z',
        windowTo: '2026-10-03T00:00:00Z',
        entries: [{ sourceCallId: CALL_A, disposition: 'withheld' }],
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('must say why');
  });

  it('rejects a call listed twice — a manifest that contradicts itself states nothing', () => {
    const result = envelopeSchema.safeParse({
      sourceSystem: 'opsdesk',
      eventId: 'e1',
      occurredAt: '2026-09-03T12:00:00Z',
      payloadType: 'manifest',
      payload: {
        scope: 'port-calls',
        windowFrom: '2026-08-04T00:00:00Z',
        windowTo: '2026-10-03T00:00:00Z',
        entries: [
          { sourceCallId: CALL_A, disposition: 'sent' },
          { sourceCallId: CALL_A, disposition: 'withheld', reason: 'transit' },
        ],
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('duplicate sourceCallId');
  });

  it('rejects a backwards window and requires no ship', () => {
    const backwards = envelopeSchema.safeParse({
      sourceSystem: 'opsdesk',
      eventId: 'e1',
      occurredAt: '2026-09-03T12:00:00Z',
      payloadType: 'manifest',
      payload: {
        scope: 'port-calls',
        windowFrom: '2026-10-03T00:00:00Z',
        windowTo: '2026-08-04T00:00:00Z',
        entries: [],
      },
    });
    expect(backwards.success).toBe(false);
    // No ship is required, unlike every other payload type
    expect(manifest([]).payload.entries).toEqual([]);
  });
});

describe('applying a manifest', () => {
  it('leaves a sent call entirely alone', async () => {
    const { service, client, updates } = harness({
      held: [heldRow({ source_call_id: CALL_A })],
    });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest([{ sourceCallId: CALL_A, disposition: 'sent' }]),
      'sr-1',
    );
    expect(outcome).toMatchObject({
      action: 'manifest_applied',
      covered: 1,
      deactivated: 0,
      retained: 0,
    });
    expect(updates()).toHaveLength(0);
  });

  it('flags a withheld call and never deactivates it — it is not gone', async () => {
    const { service, client, updates } = harness({
      held: [heldRow({ source_call_id: CALL_A })],
    });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest([
        { sourceCallId: CALL_A, disposition: 'withheld', reason: 'status:Planned' },
      ]),
      'sr-1',
    );
    expect(outcome.withheld).toBe(1);
    expect(outcome.deactivated).toBe(0);
    const [update] = updates();
    expect(update!.sql).toContain('sourceWithheld');
    expect(update!.sql).not.toContain('is_active = false');
    expect(String(update!.params?.[1])).toContain('status:Planned');
  });

  it('deactivates an untouched call the manifest omits', async () => {
    const { service, client, updates } = harness({
      held: [heldRow({ source_call_id: CALL_A, touched: false })],
    });
    const outcome = await service.apply(client, 'org_acmeship', manifest([]), 'sr-1');
    expect(outcome.deactivated).toBe(1);
    expect(outcome.retained).toBe(0);
    expect(updates()[0]!.sql).toContain('is_active = false');
    expect(updates()[0]!.sql).toContain('sourceWithdrawn');
  });

  it('keeps a touched call the manifest omits, marked withdrawn at source', async () => {
    const { service, client, updates } = harness({
      held: [heldRow({ source_call_id: CALL_A, touched: true })],
    });
    const outcome = await service.apply(client, 'org_acmeship', manifest([]), 'sr-1');
    expect(outcome.retained).toBe(1);
    expect(outcome.deactivated).toBe(0);
    expect(updates()[0]!.sql).toContain('sourceWithdrawn');
    expect(updates()[0]!.sql).not.toContain('is_active = false');
  });

  it('never sweeps a call with no ETA — the window cannot place it', async () => {
    const { service, client, queries } = harness({ held: [] });
    await service.apply(client, 'org_acmeship', manifest([]), 'sr-1');
    const select = queries.find((q) => q.sql.includes('FROM port_call pc'));
    expect(select!.sql).toContain('pc.eta IS NOT NULL');
  });

  it('audits the sweep, naming every call it deactivated', async () => {
    const { service, client, content } = harness({
      held: [heldRow({ source_call_id: CALL_A })],
    });
    await service.apply(client, 'org_acmeship', manifest([]), 'sr-1');
    const entry = content.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(entry.data['action']).toBe('manifest_applied');
    expect(entry.data['deactivatedPortCallIds']).toEqual(['pc-1111']);
    expect(entry.data['eventId']).toBe('opsdesk-manifest-1');
  });
});

describe('the circuit breaker', () => {
  /** Enough held calls that removing `absent` of them crosses the share limit. */
  function manyHeld(count: number): HeldRow[] {
    return Array.from({ length: count }, (_, i) =>
      heldRow({
        source_call_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        id: `pc-${i}`,
      }),
    );
  }

  it('holds a manifest that would remove too much, changing nothing', async () => {
    const held = manyHeld(10);
    const { service, client, updates } = harness({ held });
    // Names only two of ten as sent: eight would go, far over the limit
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest(
        held.slice(0, 2).map((r) => ({
          sourceCallId: r.source_call_id,
          disposition: 'sent' as const,
        })),
      ),
      'sr-1',
    );
    expect(outcome.action).toBe('manifest_held');
    expect(outcome.warnings).toEqual(['manifest_held']);
    expect(outcome.deactivated).toBe(0);
    expect(updates()).toHaveLength(0);
  });

  it('does not trip on a small absolute number of removals', async () => {
    // 1 of 2 is over the share limit but under the floor: an ordinary day
    const held = manyHeld(2);
    const { service, client } = harness({ held });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest([{ sourceCallId: held[0]!.source_call_id, disposition: 'sent' }]),
      'sr-1',
    );
    expect(REMOVAL_FLOOR).toBeGreaterThan(1);
    expect(1 / 2).toBeGreaterThan(REMOVAL_SHARE_LIMIT);
    expect(outcome.action).toBe('manifest_applied');
    expect(outcome.deactivated).toBe(1);
  });

  it('applies a manifest that removes a modest share', async () => {
    const held = manyHeld(40);
    const { service, client } = harness({ held });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest(
        held.slice(0, 35).map((r) => ({
          sourceCallId: r.source_call_id,
          disposition: 'sent' as const,
        })),
      ),
      'sr-1',
    );
    expect(outcome.action).toBe('manifest_applied');
    expect(outcome.deactivated).toBe(5);
  });
});

describe('deleted and recreated', () => {
  const replacement = {
    id: 'pc-new',
    source_call_id: CALL_NEW,
    eta: new Date('2026-09-10T14:00:00Z'),
    etd: new Date('2026-09-11T06:00:00Z'),
    voyage_number: '25/07',
    cargo_description: 'Bulk fertiliser',
  };

  it('adopts the new identity onto the existing call, keeping its documents', async () => {
    const { service, client, updates } = harness({
      held: [heldRow({ source_call_id: CALL_A, touched: true })],
      candidates: [replacement],
    });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest([{ sourceCallId: CALL_NEW, disposition: 'sent' }]),
      'sr-1',
    );
    expect(outcome.adopted).toBe(1);
    expect(outcome.retained).toBe(0);
    expect(outcome.deactivated).toBe(0);
    const [adopt, standDown] = updates();
    // The call people worked on survives and takes the new source id
    expect(adopt!.sql).toContain('source_call_id = $2');
    expect(adopt!.params?.[0]).toBe('pc-1111');
    expect(adopt!.params?.[1]).toBe(CALL_NEW);
    expect(String(adopt!.params?.[6])).toContain(CALL_A);
    // ...and the duplicate the content push created steps aside
    expect(standDown!.sql).toContain('is_active = false');
    expect(standDown!.params?.[0]).toBe('pc-new');
  });

  it('does not adopt when two candidates match — that would merge real calls', async () => {
    const { service, client } = harness({
      held: [heldRow({ source_call_id: CALL_A, touched: true })],
      candidates: [
        replacement,
        { ...replacement, id: 'pc-new-2', source_call_id: CALL_B },
      ],
    });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      manifest([
        { sourceCallId: CALL_NEW, disposition: 'sent' },
        { sourceCallId: CALL_B, disposition: 'sent' },
      ]),
      'sr-1',
    );
    expect(outcome.adopted).toBe(0);
    expect(outcome.retained).toBe(1);
  });

  it('does not adopt a lookalike the manifest does not vouch for', async () => {
    const { service, client } = harness({
      held: [heldRow({ source_call_id: CALL_A })],
      // Present in the database, but this manifest never mentions it
      candidates: [{ ...replacement, source_call_id: CALL_C }],
    });
    const outcome = await service.apply(client, 'org_acmeship', manifest([]), 'sr-1');
    expect(outcome.adopted).toBe(0);
    expect(outcome.deactivated).toBe(1);
  });
});
