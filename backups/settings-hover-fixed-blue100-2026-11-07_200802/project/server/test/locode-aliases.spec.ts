/**
 * Spec 0056 — legacy and superseded LOCODEs: the seed, the substitution rule,
 * the door's behaviour, and what the document checks tell a person.
 *
 * The acceptance criteria this mirrors are numbered in
 * docs/specs/0056-locode-aliases.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import {
  aliasFor,
  aliasesForCodes,
  ALIAS_RELATIONS,
  aliasSource,
  parseLocationAliases,
  readSeedFile,
  substituteFor,
  type LocationAliasRow,
} from '../src/refdata/location-aliases';
import { PortCallService, type PortCallEnvelope } from '../src/canonical/port-call.service';
import { runChecks, type CallShip } from '../src/ingest/documents/form-checks';
import type { ParsedForm } from '../src/ingest/documents/form-parser';

const SEED_PATH = join(__dirname, '..', 'src', 'refdata', 'location-aliases.json');

function row(over: Partial<LocationAliasRow> = {}): LocationAliasRow {
  return {
    givenCode: 'FIMTY',
    givenName: 'Mäntyluoto',
    relation: 'port_area_of',
    currentCode: 'FIPOR',
    note: 'Mäntyluoto is a port area of Pori (FIPOR)',
    evidence: 'FIPOR area MÄNTYLUOTO, facility FIPOR-0001',
    data: {},
    ...over,
  };
}

describe('the committed seed', () => {
  const seed = parseLocationAliases();

  it('parses with nothing skipped', () => {
    expect(seed.skipped).toBe(0);
    expect(seed.reasons).toEqual([]);
    expect(seed.rows.length).toBe(seed.received);
    expect(seed.rows.length).toBeGreaterThan(15);
  });

  it('gives every row a key, a relation and a note a person can read', () => {
    for (const r of seed.rows) {
      expect(r.givenCode ?? r.givenName).toBeTruthy();
      expect(ALIAS_RELATIONS).toContain(r.relation);
      expect(r.note.length).toBeGreaterThan(10);
      // A mapping without evidence is a guess (spec 0056, Seeding)
      expect(r.evidence).toBeTruthy();
    }
  });

  it('names its own version as provenance', () => {
    expect(aliasSource()).toMatch(/^location-aliases\.json@\d+\.\d+\.\d+$/);
  });

  it('carries the mappings the opsDesk audit verified', () => {
    const byCode = new Map(seed.rows.filter((r) => r.givenCode).map((r) => [r.givenCode!, r]));
    expect(byCode.get('FIMTY')?.currentCode).toBe('FIPOR');
    expect(byCode.get('FIMTL')?.relation).toBe('not_a_code');
    expect(byCode.get('FIMTL')?.currentCode).toBe('FIPOR');
    expect(byCode.get('FIVSS')?.currentCode).toBe('FIHEL');
    expect(byCode.get('FIYPA')?.relation).toBe('confusable_with');

    const raasepori = seed.rows.find((r) => r.givenName === 'Raasepori');
    expect(raasepori?.relation).toBe('renamed');
    expect(raasepori?.currentCode).toBe('FITAI');
    expect(raasepori?.givenCode).toBeNull();
  });

  it('is the same file the loader reads', () => {
    const onDisk = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { aliases: unknown[] };
    expect(readSeedFile()).toEqual(onDisk);
    expect(parseLocationAliases(onDisk).rows.length).toBe(seed.rows.length);
  });
});

describe('bad seed rows are skipped with a reason, never thrown (AC 2)', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['no key', { relation: 'renamed', note: 'x'.repeat(20) }],
    ['bad givenCode', { givenCode: 'FI', relation: 'renamed', note: 'x'.repeat(20) }],
    ['unknown relation', { givenCode: 'FIMTY', relation: 'guesswork', note: 'x'.repeat(20) }],
    ['no note', { givenCode: 'FIMTY', relation: 'renamed' }],
    ['bad currentCode', { givenCode: 'FIMTY', relation: 'renamed', currentCode: 'PORI', note: 'x'.repeat(20) }],
    ['circular', { givenCode: 'FIMTY', relation: 'renamed', currentCode: 'FIMTY', note: 'x'.repeat(20) }],
  ];

  for (const [label, alias] of cases) {
    it(`skips: ${label}`, () => {
      const parsed = parseLocationAliases({ aliases: [alias] });
      expect(parsed.rows).toHaveLength(0);
      expect(parsed.skipped).toBe(1);
      expect(parsed.reasons).toHaveLength(1);
    });
  }

  it('skips a duplicate key but keeps the first', () => {
    const parsed = parseLocationAliases({
      aliases: [
        { givenCode: 'FIMTY', relation: 'port_area_of', currentCode: 'FIPOR', note: 'first one here' },
        { givenCode: 'FIMTY', relation: 'port_area_of', currentCode: 'FIHEL', note: 'second one here' },
      ],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.currentCode).toBe('FIPOR');
    expect(parsed.skipped).toBe(1);
  });

  it('survives a seed that is not a list at all', () => {
    expect(parseLocationAliases({}).rows).toEqual([]);
    expect(parseLocationAliases(null).rows).toEqual([]);
  });
});

describe('what may be substituted without asking', () => {
  it('substitutes a superseded, bogus or renamed code', () => {
    expect(substituteFor(row({ relation: 'port_area_of' }))).toBe('FIPOR');
    expect(substituteFor(row({ relation: 'not_a_code' }))).toBe('FIPOR');
    expect(substituteFor(row({ relation: 'renamed' }))).toBe('FIPOR');
  });

  it('never substitutes a valid code for another place (AC 4)', () => {
    expect(
      substituteFor(row({ relation: 'confusable_with', givenCode: 'FIYPA', currentCode: 'FIKOK' })),
    ).toBeNull();
  });

  it('never substitutes when two candidates are in play (AC 5)', () => {
    const ambiguous = row({
      givenCode: 'FIRTR',
      currentCode: null,
      data: { ambiguous: ['FIRAA', 'FILAP'] },
    });
    expect(substituteFor(ambiguous)).toBeNull();
  });

  it('substitutes nothing when there is nothing to substitute to', () => {
    expect(substituteFor(row({ currentCode: null }))).toBeNull();
  });
});

describe('lookups', () => {
  function client(rows: Record<string, unknown>[]) {
    const query = jest.fn().mockResolvedValue({ rows });
    return { client: { query } as unknown as PoolClient, query };
  }

  it('finds aliases for a batch of codes, keyed by the given code', async () => {
    const { client: c, query } = client([
      {
        given_code: 'FIMTY',
        given_name: 'Mäntyluoto',
        relation: 'port_area_of',
        current_code: 'FIPOR',
        note: 'a port area of Pori',
        evidence: null,
        data: {},
      },
    ]);
    const hits = await aliasesForCodes(c, ['fimty', 'FIMTY', 'FIHEL']);
    expect(hits.get('FIMTY')?.substitute).toBe('FIPOR');
    expect(hits.size).toBe(1);
    // de-duplicated and upper-cased before the read
    expect(query.mock.calls[0]![1]).toEqual([['FIMTY', 'FIHEL']]);
  });

  it('reads nothing when there is nothing to ask about', async () => {
    const { client: c, query } = client([]);
    expect((await aliasesForCodes(c, [])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('looks a name up as readily as a code (AC 9)', async () => {
    const { client: c, query } = client([
      {
        given_code: null,
        given_name: 'Raasepori',
        relation: 'renamed',
        current_code: 'FITAI',
        note: "Raasepori's port is Tammisaari (Ekenäs) — FITAI",
        evidence: null,
        data: {},
      },
    ]);
    const hit = await aliasFor(c, ' raasepori ');
    expect(hit?.substitute).toBe('FITAI');
    expect(hit?.note).toContain('FITAI');
    expect(query.mock.calls[0]![1]).toEqual(['RAASEPORI', 'raasepori']);
  });

  it('answers null for a code nobody has an opinion about', async () => {
    const { client: c } = client([]);
    expect(await aliasFor(c, 'FIHEL')).toBeNull();
  });
});

describe('the door (spec 0026 + 0056)', () => {
  interface Captured {
    sql: string;
    params: unknown[];
  }

  function setup(alias: Record<string, unknown> | null, existing = false) {
    const captured: Captured[] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      if (sql.includes('platform.location_alias')) {
        return { rows: alias ? [alias] : [] };
      }
      if (sql.includes('FROM port_call')) {
        return {
          rows: existing
            ? [{ id: 'pc1', ship_id: 'v1', status: 'expected', data: {}, port_locode: 'FIMTY' }]
            : [],
        };
      }
      if (sql.startsWith('INSERT INTO port_call')) return { rows: [{ id: 'pc-new' }] };
      return { rows: [] };
    });
    const client = { query } as unknown as PoolClient;
    const content = jest.fn().mockResolvedValue('audit-1');
    const service = new PortCallService({} as TenantDb, {
      content,
    } as unknown as AuditService);
    return { service, client, captured, content };
  }

  const envelope = (locode: string): PortCallEnvelope =>
    ({
      sourceSystem: 'opsdesk',
      eventId: 'opsdesk-pc-2323-20260903120000',
      occurredAt: '2026-09-03T12:00:00Z',
      payloadType: 'plan',
      ship: { imoNumber: '9990026', name: 'MS Test' },
      payload: {
        sourceCallId: '11111111-2222-4333-8444-555555555555',
        portLocode: locode,
      },
    }) as unknown as PortCallEnvelope;

  const superseded = {
    given_code: 'FIMTY',
    given_name: 'Mäntyluoto',
    relation: 'port_area_of',
    current_code: 'FIPOR',
    note: 'Mäntyluoto is a port area of Pori (FIPOR)',
    evidence: 'FIPOR area MÄNTYLUOTO',
    data: {},
  };

  it('creates the call against the current code and says so (AC 3)', async () => {
    const { service, client, captured } = setup(superseded);
    const outcome = await service.apply(
      client,
      'org_acmeship',
      envelope('FIMTY'),
      'v1',
      'sr1',
    );

    expect(outcome.warnings).toEqual(['locode_substituted']);
    const insert = captured.find((c) => c.sql.startsWith('INSERT INTO port_call'))!;
    expect(insert.params).toContain('FIPOR');
    expect(insert.params).not.toContain('FIMTY');

    // the substitution is recorded where an operator can see it (AC 3/4)
    const data = JSON.parse(
      insert.params.find(
        (p): p is string => typeof p === 'string' && p.includes('suggestions'),
      )!,
    ) as { suggestions: { locode: Record<string, unknown> } };
    expect(data.suggestions.locode).toMatchObject({
      given: 'FIMTY',
      used: 'FIPOR',
      note: expect.stringContaining('Pori'),
      sourceSystem: 'opsdesk',
      eventId: 'opsdesk-pc-2323-20260903120000',
    });
  });

  it('leaves a confusable code as sent, flagged uncertain (AC 4)', async () => {
    const { service, client, captured } = setup({
      given_code: 'FIYPA',
      given_name: 'Ypäjä',
      relation: 'confusable_with',
      current_code: 'FIKOK',
      note: 'FIYPA is Ypäjä, an inland municipality with no harbour',
      evidence: null,
      data: {},
    });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      envelope('FIYPA'),
      'v1',
      'sr1',
    );

    expect(outcome.warnings).toEqual(['locode_uncertain']);
    const insert = captured.find((c) => c.sql.startsWith('INSERT INTO port_call'))!;
    expect(insert.params).toContain('FIYPA');
    expect(insert.params).not.toContain('FIKOK');
  });

  it('substitutes neither of two candidates (AC 5)', async () => {
    const { service, client, captured } = setup({
      given_code: 'FIRTR',
      given_name: 'Rautaruukki',
      relation: 'port_area_of',
      current_code: null,
      note: 'Rautaruukki is a port area of both Raahe and Lappohja',
      evidence: null,
      data: { ambiguous: ['FIRAA', 'FILAP'] },
    });
    const outcome = await service.apply(
      client,
      'org_acmeship',
      envelope('FIRTR'),
      'v1',
      'sr1',
    );

    expect(outcome.warnings).toEqual(['locode_uncertain']);
    const insert = captured.find((c) => c.sql.startsWith('INSERT INTO port_call'))!;
    expect(insert.params).toContain('FIRTR');
    const data = JSON.parse(
      insert.params.find(
        (p): p is string => typeof p === 'string' && p.includes('suggestions'),
      )!,
    ) as { suggestions: { locode: { candidates: string[] } } };
    expect(data.suggestions.locode.candidates).toEqual(['FIRAA', 'FILAP']);
  });

  it('behaves exactly as before for a code with no alias (AC 7)', async () => {
    const { service, client, captured } = setup(null);
    const outcome = await service.apply(
      client,
      'org_acmeship',
      envelope('FIHEL'),
      'v1',
      'sr1',
    );

    expect(outcome.warnings).toBeUndefined();
    const insert = captured.find((c) => c.sql.startsWith('INSERT INTO port_call'))!;
    expect(insert.params).toContain('FIHEL');
    expect(
      insert.params.some((p) => typeof p === 'string' && p.includes('suggestions')),
    ).toBe(false);
  });

  it('names both codes in the audit trail (AC 6)', async () => {
    const { service, client, content } = setup(superseded);
    await service.apply(client, 'org_acmeship', envelope('FIMTY'), 'v1', 'sr1');

    const event = content.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(event.data.locode).toMatchObject({ given: 'FIMTY', used: 'FIPOR' });
  });

  it('says nothing about a code it did not touch (AC 6, AC 7)', async () => {
    const { service, client, content } = setup(null);
    await service.apply(client, 'org_acmeship', envelope('FIHEL'), 'v1', 'sr1');

    const event = content.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(event.data.locode).toBeUndefined();
  });

  it('substitutes on an update too, not only on create', async () => {
    const { service, client, captured } = setup(superseded, true);
    const outcome = await service.apply(
      client,
      'org_acmeship',
      envelope('FIMTY'),
      'v1',
      'sr1',
    );

    expect(outcome.warnings).toEqual(['locode_substituted']);
    const update = captured.find((c) => c.sql.startsWith('UPDATE port_call'))!;
    expect(update.params).toContain('FIPOR');
  });
});

describe('what an uploaded form is told about a bad port code (AC 8)', () => {
  /** A waste form is the simplest carrier of a field LOCODE. */
  const form = (locode: string): ParsedForm =>
    ({
      formType: 'nsw-waste',
      formName: 'waste',
      context: null,
      fields: { lastPortDelivered: locode },
      rows: null,
      rowsLabel: null,
      rowsTruncated: false,
      warnings: [],
    }) as unknown as ParsedForm;

  /** Knows FIPOR and FIMTY as locations; answers alias reads from `alias`. */
  function client(alias: Record<string, unknown> | null, known: string[] = ['FIPOR']) {
    return {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('platform.location_alias')) {
          return { rows: alias ? [alias] : [] };
        }
        if (sql.includes('gisis_port_facility')) return { rows: [] };
        const wanted = (params?.[0] as string[]) ?? [];
        return {
          rows: wanted
            .filter((c) => known.includes(c))
            .map((locode) => ({ locode, name: `Port ${locode}`, facilities: null })),
        };
      }),
    } as unknown as PoolClient;
  }

  const SHIP: CallShip = { name: 'MS Test', imoNumber: '9990026' };

  const alias = (over: Record<string, unknown> = {}) => ({
    given_code: 'FIMTL',
    given_name: 'Mäntyluoto',
    relation: 'not_a_code',
    current_code: 'FIPOR',
    note: 'FIMTL is not a UN/LOCODE; Mäntyluoto is a port area of Pori (FIPOR)',
    evidence: 'absent from the world set',
    data: {},
    ...over,
  });

  it('a code the port list does not know, but we recognise: says why, offers the code', async () => {
    const checks = await runChecks(client(alias()), form('FIMTL'), SHIP);
    const note = checks.annotations['fields.lastPortDelivered']!;
    expect(note.severity).toBe('error');
    expect(note.message).toContain('Mäntyluoto');
    expect(note.suggest).toEqual(['FIPOR']);
    expect(note.kind).toBe('locode');
  });

  it('a code that resolves but is superseded: warns rather than passing it (AC 8)', async () => {
    const checks = await runChecks(
      client(
        alias({ given_code: 'FIMTY', relation: 'port_area_of' }),
        ['FIPOR', 'FIMTY'],
      ),
      form('FIMTY'),
      SHIP,
    );
    const note = checks.annotations['fields.lastPortDelivered']!;
    expect(note.severity).toBe('warning');
    expect(note.suggest).toEqual(['FIPOR']);
    expect(note.mapped).toBe('Port FIMTY');
  });

  it('offers both candidates when the alias is ambiguous', async () => {
    const checks = await runChecks(
      client(alias({ given_code: 'FIRTR', current_code: null, data: { ambiguous: ['FIRAA', 'FILAP'] } })),
      form('FIRTR'),
      SHIP,
    );
    expect(checks.annotations['fields.lastPortDelivered']!.suggest).toEqual(['FIRAA', 'FILAP']);
  });

  it('an unknown code nobody has an opinion about reads exactly as before', async () => {
    const checks = await runChecks(client(null), form('FIXXX'), SHIP);
    const note = checks.annotations['fields.lastPortDelivered']!;
    expect(note.severity).toBe('error');
    expect(note.message).toBe('not in the port master list — check the code');
    expect(note.suggest).toBeUndefined();
  });

  it('a good code stays quiet', async () => {
    const checks = await runChecks(client(null), form('FIPOR'), SHIP);
    const note = checks.annotations['fields.lastPortDelivered']!;
    expect(note.severity).toBe('ok');
    expect(note.port).toBe('FIPOR');
  });
});
