/**
 * Spec 0021 — reference-data sync: vendored codelist loader, sync-run
 * lifecycle (lock, bookkeeping, audit-in-same-tx), service upsert mapping,
 * admin endpoint guards.
 */
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import { NemoApiError, type NemoClientService } from '../src/nemo-client/nemo-client.service';
import type { NotifyService } from '../src/notify/notify.service';
import { loadFiProfile, loadFiRequired } from '../src/refdata/fi-required';
import { loadHsMap } from '../src/refdata/hs-map';
import { loadHubCodelists } from '../src/refdata/hub-codelists';
import { parseHubLocations } from '../src/refdata/hub-locations';
import { RefdataController } from '../src/refdata/refdata.controller';
import { RefdataSyncService } from '../src/refdata/refdata-sync.service';
import {
  compareSources,
  diffMigIndex,
  loadManifest,
  type ManifestEntry,
} from '../src/refdata/schema-watch';
import { loadSpreadsheetCodelists } from '../src/refdata/spreadsheet-codelists';

const VENDOR_DIR = '../vendor';

describe('vendored codelist loader (spec 0021 AC 1)', () => {
  it('loads the full vendored set with trilingual names', () => {
    const lists = loadSpreadsheetCodelists(`${VENDOR_DIR}/national-spreadsheet`);
    expect(lists.length).toBeGreaterThanOrEqual(50);
    const entries = lists.reduce((n, l) => n + l.entries.length, 0);
    expect(entries).toBeGreaterThanOrEqual(8000);

    const certTypes = lists.find((l) => l.codelist === 'certificate_type');
    expect(certTypes?.version).toBe('2.0.1');
    const cl = certTypes?.entries.find((e) => e.code === 'CL');
    expect(cl).toEqual({
      code: 'CL',
      en: 'Classification certificate',
      fi: 'Luokitustodistus',
      sv: 'Klassificeringsintyg',
      national: true,
    });
  });
});

describe('vendored hub sources (spec 0023 AC 1 + 6)', () => {
  it('hub codelists: 130+ lists, FI-preferred flags, hs_cargo_item empty', () => {
    const { lists, emptyLists } = loadHubCodelists(VENDOR_DIR);
    expect(lists.length).toBeGreaterThanOrEqual(130);
    expect(emptyLists).toContain('hs_cargo_item');
    const cert = lists.find((l) => l.name === 'certificate_type');
    expect(cert?.entries).toHaveLength(64);
    expect(cert?.entries.filter((e) => e.fiPreferred).map((e) => e.code).sort()).toEqual(
      ['CL', 'ISPS', 'LL', 'OTHER', 'REG', 'TM'],
    );
    expect(lists.find((l) => l.name === 'crew_role')?.entries.length).toBeGreaterThan(250);
  });

  it('hs map: 46 entries, hs6 always 6 digits, hsPrinted as the page prints it', () => {
    const entries = loadHsMap(VENDOR_DIR);
    expect(entries.length).toBeGreaterThanOrEqual(40);
    expect(entries.every((e) => /^\d{6}$/.test(e.hs6))).toBe(true);
    const fruit = entries.find((e) => e.refinement === 'Tuoreet hedelmät');
    // The page printed 81090 until 2026-09-25 and 081090 since (hub deploy of
    // that day); hs6 is the padded form either way (spec 0024 adoption note).
    expect(fruit).toMatchObject({ groupCode: '42', hsPrinted: '081090', hs6: '081090' });
    const sellu = entries.find((e) => e.groupCode === '22' && e.refinement === 'Sellu');
    expect(sellu?.hs6).toBe('470500');
  });
});

describe('FI requirement profile (spec 0028 AC 1-3)', () => {
  it('vendored page: 27 formalities, NOA carries its elements with conditions', () => {
    const formalities = loadFiRequired(VENDOR_DIR);
    expect(formalities).toHaveLength(27);
    const noa = formalities.find((f) => f.code === 'NOA');
    expect(noa?.elements).toHaveLength(44);
    const eta = noa?.elements.find((e) => e.de === 'DE-022-02');
    expect(eta?.nameEn.toLowerCase()).toContain('arrival');
    const statement = noa?.elements.find((e) => e.de === 'DE-003-07');
    expect([...(statement?.conditions ?? [])].sort()).toEqual(['NG-NOA-108', 'NR-NOA-108']);
  });

  it('profile join: matrix M/O + occurrence; discrepancies flagged, never dropped', () => {
    const profile = loadFiProfile(VENDOR_DIR);
    const noa = profile.find((f) => f.code === 'NOA');
    const eta = noa?.elements.find((e) => e.de === 'DE-022-02');
    expect(eta).toMatchObject({ status: 'M', occurrence: '1..1', pageOnly: false });
    // Voyage number is Optional — resolves open question 9
    const voyage = noa?.elements.find((e) => e.de === 'DE-014-02');
    expect(voyage).toMatchObject({ status: 'O', occurrence: '0..1' });
    // The page and the Excel matrices disagree on a few elements (spec 0028):
    // the join must surface that, not hide it
    const flagged = profile.flatMap((f) =>
      f.elements.filter((e) => e.pageOnly || e.matrixOnly),
    );
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('the schema watch covers the FI profile page (spec 0028 AC 2)', () => {
    const manifest = loadManifest(VENDOR_DIR);
    expect(manifest.length).toBeGreaterThanOrEqual(42);
    const entry = manifest.find((e) => e.file === 'hub/fi-required.json');
    expect(entry?.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

interface MockCall {
  sql: string;
  params: unknown[] | undefined;
}

function makeHarness(opts: {
  lock?: boolean;
  locationsFetcher?: (url: string) => Promise<string>;
  fetchHazmatItems?: () => Promise<unknown[]>;
  target?: string;
  hazmatBase?: string | null;
  alertEmail?: string;
  /** The ships job (spec 0068): the org whose key NSD lookups borrow, the NSD doubles, known hulls by IMO. */
  refdataOrgSlug?: string;
  findShips?: (org: string, q: string) => Promise<unknown[]>;
  getShip?: (org: string, uuid: string) => Promise<unknown>;
  existingShips?: Record<string, { id: string; data: Record<string, unknown> }>;
}) {
  const calls: MockCall[] = [];
  const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) {
      return { rows: [{ ok: opts.lock !== false }] };
    }
    if (sql.includes('INSERT INTO platform.sync_run')) {
      return { rows: [{ id: 'run-1', started: new Date('2026-08-22T10:00:00Z') }] };
    }
    if (sql.includes('RETURNING finished')) {
      return { rows: [{ finished: new Date('2026-08-22T10:00:05Z') }] };
    }
    if (sql.includes('FROM platform.ship WHERE imo_number = $1')) {
      const hit = opts.existingShips?.[String(params?.[0])];
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO platform.location')) {
      // Guarded upsert (spec 0027): every tuple affected, reported as insert
      const tuples = (params?.length ?? 0) / 6;
      return { rows: Array.from({ length: tuples }, () => ({ inserted: true })) };
    }
    return { rows: [] };
  });
  const release = jest.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const poolQuery = jest.fn().mockResolvedValue({ rows: [] });
  const pool = {
    connect: jest.fn().mockResolvedValue(client),
    query: poolQuery,
  } as unknown as Pool;
  const config = {
    get: (key: string) =>
      key === 'REFDATA_DIR'
        ? VENDOR_DIR
        : key === 'ADMIN_ALERT_EMAIL'
          ? opts.alertEmail
          : key === 'NEMO_REFDATA_ORG_SLUG'
            ? opts.refdataOrgSlug
            : undefined,
  } as unknown as ConfigService;
  const target = opts.target ?? 'mock';
  const nemo = {
    target,
    refdataBase: jest.fn(() =>
      opts.hazmatBase !== undefined ? opts.hazmatBase : 'http://127.0.0.1:4012',
    ),
    refdataUrlVar: jest.fn(
      (service: string) =>
        `NEMO_${service.toUpperCase()}${target === 'mock' ? '_MOCK_URL' : '_URL'}`,
    ),
    fetchHazmatItems: jest.fn(opts.fetchHazmatItems ?? (async () => [])),
    findShips: jest.fn(opts.findShips ?? (async () => [])),
    getShip: jest.fn(opts.getShip ?? (async () => null)),
  };
  const content = jest.fn().mockResolvedValue('audit-1');
  const sendTracked = jest.fn().mockResolvedValue({ emailMessageId: 'e1', status: 'sent' });
  const service = new RefdataSyncService(
    pool,
    config,
    nemo as unknown as NemoClientService,
    { content } as unknown as AuditService,
    { sendTracked } as unknown as NotifyService,
  );
  service.locationsFetcher = jest.fn(
    opts.locationsFetcher ?? (async () => JSON.stringify({ locodes: [{ locode: 'FIHEL' }] })),
  );
  return { service, calls, content, release, nemo, clientQuery, sendTracked, poolQuery };
}

describe('schema watch diff (spec 0024 AC 2)', () => {
  const entries: ManifestEntry[] = [
    { file: 'mig/2010/ATA_2.0.1.0.json', source: 'u1', sha256: 'x', sourceSha256: 'aaa' },
    { file: 'openapi/declarant.json', source: 'u2', sha256: 'x', sourceSha256: 'bbb' },
    { file: 'hub/rcg.json', source: 'u3', sha256: 'x' }, // vendored before baselines
    { file: 'mig/index.json', source: 'u4', sha256: 'x', sourceSha256: 'ccc' },
  ];

  it('buckets changed and missing-baseline sources', () => {
    const res = compareSources(
      entries,
      new Map([
        ['mig/2010/ATA_2.0.1.0.json', 'aaa'],
        ['openapi/declarant.json', 'DRIFTED'],
        ['hub/rcg.json', 'zzz'],
        ['mig/index.json', 'ccc'],
      ]),
    );
    expect(res.changed).toEqual(['openapi/declarant.json']);
    expect(res.missingBaseline).toEqual(['hub/rcg.json']);
  });

  it('detects new and removed schema files via the vendored index', () => {
    const upstream = {
      schemas: [
        { file: 'https://hub/schema/2010/ATA_2.0.1.0.json' },
        { file: 'https://hub/schema/2010/NEW_2.0.2.0.json' },
      ],
    };
    expect(diffMigIndex(upstream, entries)).toEqual({
      newUpstream: ['NEW_2.0.2.0.json'],
      removedUpstream: [],
    });
    expect(
      diffMigIndex({ schemas: [{ file: 'https://hub/schema/2010/NEW_2.0.2.0.json' }] }, entries),
    ).toEqual({ newUpstream: ['NEW_2.0.2.0.json'], removedUpstream: ['ATA_2.0.1.0.json'] });
  });

  it('the real manifest carries a baseline for every file (spec 0024 AC 1)', () => {
    const manifest = loadManifest(VENDOR_DIR);
    expect(manifest.length).toBeGreaterThanOrEqual(41);
    expect(manifest.every((e) => /^[0-9a-f]{64}$/.test(e.sourceSha256 ?? ''))).toBe(true);
    expect(manifest.some((e) => e.file === 'mig/index.json')).toBe(true);
  });
});

describe('drift alert (spec 0024 AC 4)', () => {
  const drift = {
    checked: 41,
    changed: ['openapi/declarant.json'],
    newUpstream: [],
    removedUpstream: [],
    missingBaseline: [],
  };
  const alert = (h: ReturnType<typeof makeHarness>, runId: string, stats: unknown) =>
    (h.service as unknown as {
      maybeAlertSchemaDrift: (id: string, s: unknown) => Promise<void>;
    }).maybeAlertSchemaDrift(runId, stats);

  it('emails on new drift with the drifted file listed', async () => {
    const h = makeHarness({ alertEmail: 'ops@nauticai.net' });
    await alert(h, 'run-1', drift);
    expect(h.sendTracked).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@nauticai.net',
        template: 'schema-drift',
        relatedEntityId: 'run-1',
        textBody: expect.stringContaining('openapi/declarant.json'),
      }),
    );
  });

  it('does not re-send while the drift set is unchanged, re-sends when it changes', async () => {
    const h = makeHarness({ alertEmail: 'ops@nauticai.net' });
    h.poolQuery.mockResolvedValue({ rows: [{ stats: drift }] });
    await alert(h, 'run-2', drift);
    expect(h.sendTracked).not.toHaveBeenCalled();
    await alert(h, 'run-3', { ...drift, changed: ['hub/rcg.json'] });
    expect(h.sendTracked).toHaveBeenCalledTimes(1);
  });

  it('no recipient -> logs only; clean result -> nothing at all', async () => {
    const noEmail = makeHarness({});
    await alert(noEmail, 'run-4', drift);
    expect(noEmail.sendTracked).not.toHaveBeenCalled();

    const clean = makeHarness({ alertEmail: 'ops@nauticai.net' });
    await alert(clean, 'run-5', { ...drift, changed: [] });
    expect(clean.sendTracked).not.toHaveBeenCalled();
    expect(clean.poolQuery).not.toHaveBeenCalled(); // no drift = no lookups
  });
});

describe('sync-run lifecycle (spec 0021 AC 3)', () => {
  it('refuses a second concurrent run of the same job', async () => {
    const { service, calls, release } = makeHarness({ lock: false });
    await expect(service.run('codelists', 'admin@x')).rejects.toThrow(ConflictException);
    expect(calls.some((c) => c.sql.includes('INSERT INTO platform.sync_run'))).toBe(false);
    expect(release).toHaveBeenCalled();
  });

  it('a successful run commits data + status + audit together', async () => {
    const { service, calls, content } = makeHarness({});
    const run = await service.run('codelists', 'worker');

    expect(run.status).toBe('ok');
    // union (spec 0023): hub lists authoritative + spreadsheet-only fallback
    expect(run.stats.hubLists as number).toBeGreaterThanOrEqual(130);
    expect(run.stats.spreadsheetLists as number).toBeGreaterThanOrEqual(15);
    expect(run.stats.entries as number).toBeGreaterThanOrEqual(12000);
    const hubUpsert = calls.find(
      (c) => c.sql.includes('INSERT INTO platform.codelist_entry') && c.params?.[1] === 'hub',
    );
    expect(hubUpsert?.sql).toContain('fi_preferred');
    const ssUpsert = calls.find(
      (c) => c.sql.includes('INSERT INTO platform.codelist_entry') && c.params?.[1] === '2.0.1',
    );
    expect(ssUpsert).toBeDefined();
    expect(calls.some((c) => c.sql.includes('SET is_active = false') && c.sql.includes('version <> $2'))).toBe(true);

    // stale takeover happens under the lock, before the new run row
    const staleIdx = calls.findIndex((c) => c.sql.includes(`error = 'stale`));
    const insertIdx = calls.findIndex((c) => c.sql.includes('INSERT INTO platform.sync_run'));
    expect(staleIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(staleIdx);

    // upserts + final status live inside one BEGIN..COMMIT
    const beginIdx = calls.findIndex((c) => c.sql === 'BEGIN');
    const upsertIdx = calls.findIndex((c) => c.sql.includes('INSERT INTO platform.codelist_entry'));
    const finishIdx = calls.findIndex((c) => c.sql.includes('RETURNING finished'));
    const commitIdx = calls.findIndex((c) => c.sql === 'COMMIT');
    expect(beginIdx).toBeLessThan(upsertIdx);
    expect(upsertIdx).toBeLessThan(finishIdx);
    expect(finishIdx).toBeLessThan(commitIdx);

    // audit event written with the run's client (same tx), platform chain
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'refdata_sync',
        entityId: 'run-1',
        actorId: 'worker',
        data: expect.objectContaining({ job: 'codelists', status: 'ok' }),
      }),
      expect.anything(),
    );
    // the lock is released at the end
    expect(calls[calls.length - 1]?.sql).toContain('pg_advisory_unlock');
  });

  it('a failed fetch rolls the data back and records a failed run', async () => {
    const { service, calls, content } = makeHarness({
      locationsFetcher: async () => {
        throw new Error('boom');
      },
    });
    const run = await service.run('locations', 'admin@x');
    expect(run.status).toBe('failed');
    expect(run.error).toBe('boom');
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(true);
    const failCall = calls.find(
      (c) => c.sql.includes('RETURNING finished') && c.params?.includes('failed'),
    );
    expect(failCall).toBeDefined();
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', error: 'boom' }),
      }),
      expect.anything(),
    );
  });
});

describe('not configured is a state, not a failure (spec 0021 AC 4 + 0027 AC 4)', () => {
  it('hazmat on stg without a URL is unavailable; locations needs no config', () => {
    const { service } = makeHarness({ target: 'stg', hazmatBase: null });
    const hazmat = service.availability('hazmat');
    expect(hazmat.available).toBe(false);
    expect(hazmat.reason).toContain('NEMO_HAZMAT_URL');
    // Locations sync from the hub's published dataset (spec 0027) — always on
    expect(service.availability('locations').available).toBe(true);
    expect(service.availability('codelists').available).toBe(true);
  });

  it('running an unavailable job throws 503, never a failed run row', async () => {
    const { service, calls } = makeHarness({ target: 'stg', hazmatBase: null });
    await expect(service.run('hazmat', 'admin@x')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('hub locations parser (spec 0027 AC 1 + 2)', () => {
  const AREA = {
    code: 'FIHEL-ES',
    portName: 'Helsinki',
    portAreaName: 'Eteläsatama',
    gisisCode: 'FIHEL-0006',
    isps: true,
    portFacilityCodes: ['FIHEL-0006'],
    berths: [{ code: 'FIHEL-ES-EO1', name: 'FIHEL-ES-EO1' }],
    anchorages: [],
  };

  it('maps entries: country from the prefix, rich data only when non-empty', () => {
    const parsed = parseHubLocations(
      JSON.stringify({
        locodes: [
          {
            locode: 'FIHEL',
            locationName: 'Helsinki (Helsingfors)',
            portFacilityCodes: ['FIHEL-0006'],
            anchorages: [],
            portAreas: [AREA],
          },
          { locode: 'SESTO', locationName: 'Stockholm', portFacilityCodes: [], anchorages: [], portAreas: [] },
          { locode: 'FIHEL', locationName: 'Helsinki v2' }, // same key — last wins
          { locationName: 'no locode' }, // skipped
        ],
      }),
    );
    expect(parsed.received).toBe(4);
    expect(parsed.skipped).toBe(1);
    expect(parsed.rows).toHaveLength(2);
    const hel = parsed.rows.find((r) => r.locode === 'FIHEL');
    expect(hel).toEqual({
      locode: 'FIHEL',
      name: 'Helsinki v2',
      country: 'FI',
      data: {},
    });
    const sto = parsed.rows.find((r) => r.locode === 'SESTO');
    expect(sto?.data).toEqual({}); // empty arrays stay out of data
  });

  it('keeps port areas with berths for the rich entries', () => {
    const parsed = parseHubLocations(
      JSON.stringify({
        locodes: [
          { locode: 'FIHEL', locationName: 'Helsinki', portAreas: [AREA], portFacilityCodes: ['FIHEL-0006'] },
        ],
      }),
    );
    expect(parsed.rows[0]?.data).toEqual({
      portAreas: [AREA],
      portFacilityCodes: ['FIHEL-0006'],
    });
  });

  it('rejects an unusable file outright (not JSON / wrong shape / nothing usable)', () => {
    expect(() => parseHubLocations('<html>')).toThrow('not valid JSON');
    expect(() => parseHubLocations('{"nope": []}')).toThrow('no locodes array');
    expect(() => parseHubLocations('{"locodes": [{"x": 1}]}')).toThrow('no usable entries');
  });
});

describe('upsert mapping (spec 0021 AC 2)', () => {
  it('locations: guarded upsert rewrites only changed rows, honest stats (spec 0027 AC 3)', async () => {
    const { service, calls } = makeHarness({
      locationsFetcher: async () => JSON.stringify({
        locodes: [
          { locode: 'FIHEL', locationName: 'Helsinki (Helsingfors)', portAreas: [{ code: 'FIHEL-ES' }] },
          { locode: 'SESTO', locationName: 'Stockholm' },
          { locationName: 'no locode' },
        ],
      }),
    });
    const run = await service.run('locations', 'worker');
    expect(run.status).toBe('ok');
    expect(run.stats).toEqual({
      received: 3,
      inserted: 2,
      updated: 0,
      unchanged: 0,
      skipped: 1,
      // The curated legacy-code seed rides along with the locations job
      // (spec 0056) — same guarded-upsert reporting, its own counts.
      aliases: expect.objectContaining({
        received: expect.any(Number),
        inserted: expect.any(Number),
        updated: expect.any(Number),
        unchanged: expect.any(Number),
        skipped: 0,
      }),
    });

    const upsert = calls.find((c) => c.sql.includes('INSERT INTO platform.location '));
    expect(upsert?.sql).toContain('ON CONFLICT (locode) WHERE is_active');
    // Churn control: unchanged rows must not be rewritten daily
    expect(upsert?.sql).toContain('IS DISTINCT FROM');
    expect(upsert?.sql).toContain('RETURNING (xmax = 0) AS inserted');
    expect(upsert?.params?.slice(0, 3)).toEqual(['FIHEL', 'Helsinki (Helsingfors)', 'FI']);
    expect(JSON.parse(upsert?.params?.[3] as string)).toEqual({
      portAreas: [{ code: 'FIHEL-ES' }],
    });
    expect(upsert?.params?.[5]).toBe('nemo-hub-locations');
  });

  it('locations: seeds the legacy-code aliases with the same churn control (spec 0056 AC 2)', async () => {
    const { service, calls } = makeHarness({
      locationsFetcher: async () => JSON.stringify({
        locodes: [{ locode: 'FIHEL', locationName: 'Helsinki' }],
      }),
    });
    const run = await service.run('locations', 'worker');
    expect(run.status).toBe('ok');

    const seeded = calls.filter((c) => c.sql.includes('platform.location_alias'));
    expect(seeded.length).toBeGreaterThan(15);
    expect(seeded[0]?.sql).toContain(
      "ON CONFLICT (COALESCE(given_code, ''), COALESCE(given_name, ''))",
    );
    expect(seeded[0]?.sql).toContain('IS DISTINCT FROM');
    expect(seeded[0]?.sql).toContain('RETURNING (xmax = 0) AS inserted');

    // Mäntyluoto's mapping travels with its evidence and its provenance
    const mty = seeded.find((c) => (c.params as unknown[])?.[0] === 'FIMTY');
    expect(mty?.params?.slice(2, 4)).toEqual(['port_area_of', 'FIPOR']);
    expect(String(mty?.params?.[5])).toContain('FIPOR-0001');
    expect(String(mty?.params?.[8])).toMatch(/^location-aliases\.json@/);

    // A valid code for another place is stored as suggest-only
    const ypa = seeded.find((c) => (c.params as unknown[])?.[0] === 'FIYPA');
    expect(ypa?.params?.[2]).toBe('confusable_with');
  });

  it('hs map: upserts on (group_code, refinement) with lifted hs6 (spec 0023 AC 2)', async () => {
    const { service, calls } = makeHarness({});
    const run = await service.run('hsmap', 'worker');
    expect(run.status).toBe('ok');
    expect(run.stats.entries as number).toBeGreaterThanOrEqual(40);
    const upsert = calls.find((c) => c.sql.includes('INSERT INTO platform.hs_map'));
    expect(upsert?.sql).toContain('ON CONFLICT (group_code, refinement) WHERE is_active');
    expect(upsert?.params?.slice(0, 4)).toEqual(['20', 'RAAKAPUU', 'Raakapuu', '440399']);
  });

  it('hazmat: keys on the service id and lifts the lookup columns', async () => {
    const { service, calls } = makeHarness({
      fetchHazmatItems: async () => [
        {
          id: 'IMDG-1090',
          properShippingName: 'ACETONE',
          UNDGnumber: '1090',
          hazardClass: '3',
        },
        { properShippingName: 'no id' },
      ],
    });
    const run = await service.run('hazmat', 'worker');
    expect(run.stats).toEqual({ received: 2, upserted: 1, skipped: 1 });
    const upsert = calls.find((c) => c.sql.includes('INSERT INTO platform.hazmat_item'));
    expect(upsert?.sql).toContain('ON CONFLICT (hazmat_id) WHERE is_active');
    expect(upsert?.params?.slice(0, 4)).toEqual(['IMDG-1090', 'ACETONE', '1090', '3']);
  });
});

describe('hazmat file import (spec 0062 AC 6)', () => {
  it('runs the sync upsert, records an ok run and labels the source with the file', async () => {
    const { service, calls, content } = makeHarness({});
    const run = await service.importHazmat(
      [
        {
          id: 'IMDG_1203_9456',
          properShippingName: 'MOTOR SPIRIT or GASOLINE or PETROL',
          UNDGnumber: '1203',
          hazardClass: '3',
        },
        { id: 'IBC_0000_10000', properShippingName: 'Triethylbenzene', hazardClass: 'S/P', UNDGnumber: null },
        { properShippingName: 'no id' },
      ],
      'refdata-import',
      'stg-hazmat-all.json',
    );
    expect(run.job).toBe('hazmat');
    expect(run.status).toBe('ok');
    expect(run.stats).toEqual({ received: 3, upserted: 2, skipped: 1 });
    const upsert = calls.find((c) => c.sql.includes('INSERT INTO platform.hazmat_item'));
    expect(upsert?.sql).toContain('ON CONFLICT (hazmat_id) WHERE is_active');
    expect(upsert?.params?.slice(0, 4)).toEqual([
      'IMDG_1203_9456',
      'MOTOR SPIRIT or GASOLINE or PETROL',
      '1203',
      '3',
    ]);
    expect(upsert?.params?.[6]).toBe('nemo-hazmat-service@mock via file stg-hazmat-all.json');
    // second row (bulk item): no UN number
    expect(upsert?.params?.[9]).toBeNull();
    const runRow = calls.find((c) => c.sql.includes('INSERT INTO platform.sync_run'));
    expect(runRow?.params).toEqual(['hazmat', 'refdata-import']);
    expect(content).toHaveBeenCalled();
  });
});

describe('admin endpoints (spec 0021 AC 6)', () => {
  function makeController() {
    const poolQuery = jest.fn().mockResolvedValue({ rows: [] });
    const pool = { query: poolQuery } as unknown as Pool;
    const sync = { availability: jest.fn(), run: jest.fn() };
    const controller = new RefdataController(pool, sync as unknown as RefdataSyncService);
    return { controller, poolQuery, sync };
  }

  it('hazmat search never matches the internal row id (user decision 2026-09-24)', async () => {
    const { controller, poolQuery } = makeController();
    // list query answers first, count query second (Promise.all order)
    poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await controller.hazmat('1024');
    expect(poolQuery).toHaveBeenCalledTimes(2);
    for (const call of poolQuery.mock.calls) {
      const sql = call[0] as string;
      expect(sql).not.toContain('hazmat_id ILIKE');
      expect(sql).toContain("COALESCE(undg_number, '') ILIKE $1");
      expect(sql).toContain("COALESCE(proper_shipping_name, '') ILIKE $1");
      expect(call[1]).toEqual(['%1024%']);
    }
  });

  it('rejects unknown sync jobs and bad codelist names', async () => {
    const { controller } = makeController();
    const req = { user: { username: 'admin@x' } } as never;
    await expect(controller.runSync(req, 'DROP TABLE')).rejects.toThrow('Unknown sync job');
    await expect(controller.codelistEntries('no-dashes-allowed!')).rejects.toThrow(
      'Invalid codelist name',
    );
  });

  it('escapes LIKE wildcards in the search input', async () => {
    const { controller, poolQuery } = makeController();
    poolQuery.mockResolvedValue({ rows: [{ total: 0 }] });
    await controller.codelistEntries('certificate_type', 'ad%_\\');
    const pattern = poolQuery.mock.calls[0][1][1];
    expect(pattern).toBe('%ad\\%\\_\\\\%');
  });

  it('lists the watched contracts from the manifest (spec 0025 AC 4)', () => {
    const { controller, sync } = makeController();
    (sync as { watchedFiles?: unknown }).watchedFiles = jest
      .fn()
      .mockReturnValue([
        { file: 'mig/2010/ATA_2.0.1.0.json', source: 'https://hub/x', sha256: 'abc' },
      ]);
    expect(controller.contracts()).toEqual({
      contracts: [
        {
          file: 'mig/2010/ATA_2.0.1.0.json',
          source: 'https://hub/x',
          sha256: 'abc',
          sourceSha256: null,
        },
      ],
    });
  });

  it('watchedFiles reads the real vendored manifest', () => {
    const { service } = makeHarness({});
    const files = service.watchedFiles();
    expect(files.length).toBeGreaterThanOrEqual(41);
    expect(files.some((f) => f.file === 'mig/index.json')).toBe(true);
  });
});

// ---- the ship master list sync (spec 0068 AC 6) ------------------------------
describe('the ship master list sync (spec 0068 AC 6)', () => {
  const FEED = JSON.stringify([
    {
      visitId: 'FI20260910-002-2', vesselId: '9113018', vesselName: 'PASILA', portOfCall: 'FIKOK',
      eta: '2099-10-06T12:17:00.000Z', etd: '2099-10-08T15:00:00.000Z', status: 'Expected to Arrive',
      updateTime: '2026-09-10T12:20:12.017Z',
    },
    {
      visitId: 'FI20260910-001-1', vesselId: '', portOfCall: 'FIKOK', eta: '2099-10-05T21:00:00.000Z',
      status: 'Cancelled', updateTime: '2026-09-10T11:42:20.185Z',
    },
    {
      visitId: 'FI20260915-002-7', vesselId: '9769104', vesselName: 'EEVA VG', portOfCall: 'FIKOK',
      eta: '2026-09-17T05:17:00.000Z', etd: '2026-10-02T05:18:00.000Z', status: 'Cancelled',
      updateTime: '2026-09-15T05:18:28.198Z',
    },
  ]);

  it('creates master rows from the visits with the digitraffic lane and the last visit; NSD skipped on mock', async () => {
    const { service, calls } = makeHarness({});
    service.digitrafficFetcher = async (url, user) => {
      expect(url).toBe('https://meri.digitraffic.fi/api/port-call/v2/visits');
      expect(user).toBe('nemolink');
      return FEED;
    };
    const run = await service.run('ships', 'test');
    expect(run.status).toBe('ok');
    expect(run.stats).toEqual(
      expect.objectContaining({ visits: 3, withoutImo: 1, created: 2, updated: 0, unchanged: 0 }),
    );
    expect((run.stats as { nsd: { skipped: boolean } }).nsd.skipped).toBe(true);
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO platform.ship'));
    expect(inserts).toHaveLength(2);
    const pasila = inserts.find((c) => c.params?.[1] === '9113018')!;
    expect(pasila.params?.[0]).toBe('PASILA');
    expect(pasila.sql).toContain("'digitraffic'");
    const data = JSON.parse(pasila.params?.[2] as string);
    expect(data.lanes.digitraffic.fields).toEqual({ name: 'PASILA' });
    expect(data.lanes.digitraffic.occurredAt).toBe('2026-09-10T12:20:12.017Z');
    expect(data.digitraffic).toEqual(
      expect.objectContaining({ visitId: 'FI20260910-002-2', portOfCall: 'FIKOK', status: 'Expected to Arrive' }),
    );
  });

  it('updates a known hull only when the visit is newer, never over a customer system\'s name', async () => {
    const existing = {
      id: 'ship-1',
      data: {
        lanes: {
          opsdesk: {
            receivedAt: 't', occurredAt: '2026-09-01T00:00:00Z', eventId: 'e', sourceRecordId: 's',
            org: 'acmeship', fields: { name: 'Pasila (opsDesk)' },
          },
        },
      },
    };
    const { service, calls } = makeHarness({ existingShips: { '9113018': existing } });
    service.digitrafficFetcher = async () => FEED;
    const run = await service.run('ships', 'test');
    expect(run.stats).toEqual(expect.objectContaining({ created: 1, updated: 1 }));
    const update = calls.find((c) => c.sql.includes('UPDATE platform.ship') && c.params?.[0] === 'ship-1')!;
    const data = JSON.parse(update.params?.[1] as string);
    expect(data.lanes.digitraffic.fields.name).toBe('PASILA');
    expect(data.lanes.opsdesk.fields.name).toBe('Pasila (opsDesk)');
    expect(update.params?.[2]).toBe(false); // the name column is opsDesk's to set (tier 1)

    // a rerun with the same feed changes nothing
    const again = makeHarness({ existingShips: { '9113018': { id: 'ship-1', data } } });
    again.service.digitrafficFetcher = async () => FEED;
    const second = await again.service.run('ships', 'test');
    expect(second.stats).toEqual(expect.objectContaining({ unchanged: 1 }));
  });

  it('asks NSD about the ships with upcoming calls on a real target, borrowing the named org', async () => {
    const findShips = jest.fn(async (_org: string, q: string) =>
      q === '9113018' ? [{ id: 'uuid-pasila', imoid: '9113018', name: 'PASILA' }] : [],
    );
    const getShip = jest.fn(async () => ({
      shipId: { id: 'uuid-pasila', name: 'PASILA', imoid: '9113018', mmsiid: '230123456', callsignid: 'OJPA' },
    }));
    const existing = {
      '9113018': { id: 'ship-1', data: {} },
      '9769104': { id: 'ship-2', data: {} },
    };
    const { service, calls } = makeHarness({
      target: 'stg', hazmatBase: 'x', refdataOrgSlug: 'fleetco', findShips, getShip, existingShips: existing,
    });
    service.digitrafficFetcher = async () => FEED;
    const run = await service.run('ships', 'test');
    expect(run.status).toBe('ok');
    const nsd = (run.stats as { nsd: Record<string, unknown> }).nsd;
    // EEVA VG's visit is cancelled and past: only PASILA has an upcoming call
    expect(nsd).toEqual(expect.objectContaining({ candidates: 1, looked: 1, found: 1, absent: 0 }));
    expect(findShips).toHaveBeenCalledWith('fleetco', '9113018');
    const update = calls
      .filter((c) => c.sql.includes('UPDATE platform.ship') && c.params?.[0] === 'ship-1')
      .pop()!;
    const data = JSON.parse(update.params?.[1] as string);
    expect(data.nemo.shipId).toBe('uuid-pasila');
    expect(data.nemo.fields.name).toBe('PASILA');
    expect(data.lanes.nsd).toBeDefined();
  });

  it('a 403 from NEMO stops the NSD step at once, with the words (edge closed to API clients, 2026-09-25)', async () => {
    const findShips = jest.fn(async () => {
      throw new NemoApiError(403, '');
    });
    const existing = {
      '9113018': { id: 'ship-1', data: {} },
      '9769104': { id: 'ship-2', data: {} },
    };
    const { service } = makeHarness({
      target: 'stg', hazmatBase: 'x', refdataOrgSlug: 'fleetco', findShips, existingShips: existing,
    });
    service.digitrafficFetcher = async () => FEED;
    const run = await service.run('ships', 'test');
    expect(run.status).toBe('ok');
    const nsd = (run.stats as { nsd: Record<string, unknown> }).nsd;
    expect(nsd).toEqual(expect.objectContaining({ errors: 1, looked: 0 }));
    expect(String(nsd['stopped'])).toMatch(/ship-database read for this API client/);
    expect(findShips).toHaveBeenCalledTimes(1);
  });

  it('without a borrowing org the NSD step is skipped with the reason; the visits still land', async () => {
    const { service } = makeHarness({ target: 'stg', hazmatBase: 'x' });
    service.digitrafficFetcher = async () => FEED;
    const run = await service.run('ships', 'test');
    expect(run.status).toBe('ok');
    expect((run.stats as { created: number }).created).toBe(2);
    expect((run.stats as { nsd: { reason: string } }).nsd.reason).toContain('NEMO_REFDATA_ORG_SLUG');
  });
});
