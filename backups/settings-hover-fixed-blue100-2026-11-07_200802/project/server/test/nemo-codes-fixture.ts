/**
 * NEMO code lists for tests (spec 0093): the vendored hub file — the same
 * source the refdata sync loads into platform.codelist_entry — served
 * through a fake client that answers form-codes' two reads.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PoolClient } from 'pg';

const HUB = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'vendor', 'nemo', 'hub', 'codelists.json'), 'utf-8'),
) as {
  lists: { name: string; entries: { id: string; en: string | null; fi: string | null; sv: string | null }[] }[];
};

export function codesClient(
  aliases: { normalized_text: string; code: string; codelist: string }[] = [],
): PoolClient {
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const wanted = (params?.[0] as string[]) ?? [];
      if (sql.includes('mapping_alias')) return { rows: aliases.filter((a) => wanted.includes(a.codelist)) };
      return {
        rows: HUB.lists
          .filter((l) => wanted.includes(l.name))
          .flatMap((l) => l.entries.map((e) => ({ codelist: l.name, code: e.id, en: e.en, fi: e.fi, sv: e.sv }))),
      };
    }),
  } as unknown as PoolClient;
}
