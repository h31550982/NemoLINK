/**
 * The columns of a Ship forms table in groups by meaning, and the groups
 * fitted to the room there is (user 2026-11-02): one tab per group of
 * columns instead of a sideways scroll. Groups that fit side by side share
 * a tab ("Person & Birth"); a group too wide for the room is split
 * ("Identity document 1/2"); when everything fits there are no tabs.
 */
import type { NemoCell, NemoRow, NemoTable } from '../auth/auth';

export interface ColumnGroup {
  label: string;
  keys: string[];
}

/** One tab: its columns, its name, and whether a value in them needs a person. */
export interface ColumnSegment {
  id: string;
  label: string;
  keys: string[];
  mark: 'error' | 'check' | null;
}

const PERSON_BIRTH_ID: ColumnGroup[] = [
  { label: 'Birth', keys: ['dateOfBirth', 'placeOfBirth', 'countryOfBirth'] },
  { label: 'Identity document', keys: ['documentType', 'documentNumber', 'documentIssuer', 'documentExpiry'] },
  { label: 'Permits', keys: ['residencePermit', 'visaNumber'] },
];

const GROUPS: Record<NemoTable['key'], ColumnGroup[]> = {
  crew: [
    { label: 'Person', keys: ['familyName', 'givenName', 'rank', 'nationality', 'gender'] },
    ...PERSON_BIRTH_ID,
    { label: 'Crew effects', keys: ['effectsType', 'effectsDescription', 'effectsQuantity', 'effectsUnit'] },
  ],
  passengers: [
    { label: 'Person', keys: ['personType', 'familyName', 'givenName', 'nationality', 'gender'] },
    ...PERSON_BIRTH_ID,
    { label: 'Journey', keys: ['embarkationPort', 'disembarkationPort', 'inTransit'] },
    { label: 'Care & contact', keys: ['specialCare', 'emergencyContact'] },
  ],
  cargo: [
    { label: 'Goods', keys: ['description', 'hsCode', 'grossWeight'] },
    { label: 'Journey', keys: ['loadingPort', 'dischargePort'] },
    { label: 'Documents & packages', keys: ['blNumber', 'marksAndNumbers', 'packages', 'measurement'] },
  ],
  stores: [
    { label: 'Article', keys: ['article', 'articleName'] },
    { label: 'Amount', keys: ['quantity', 'unit'] },
    { label: 'Location', keys: ['location'] },
  ],
  waste: [
    { label: 'Waste', keys: ['description', 'toDeliver'] },
    { label: 'Storage', keys: ['capacity', 'retained', 'generated'] },
    { label: 'Delivery', keys: ['remainderPort'] },
  ],
  security: [
    { label: 'Port call', keys: ['start', 'end', 'port', 'facility'] },
    { label: 'Security', keys: ['level', 'measures'] },
  ],
  health: [],
};

/** The table's groups, only with the columns it has; any column left over goes last. */
export function groupsOf(table: NemoTable): ColumnGroup[] {
  const has = new Set(table.columns.map((c) => c.key));
  const groups = (GROUPS[table.key] ?? [])
    .map((g) => ({ label: g.label, keys: g.keys.filter((k) => has.has(k)) }))
    .filter((g) => g.keys.length > 0);
  const placed = new Set(groups.flatMap((g) => g.keys));
  const rest = table.columns.map((c) => c.key).filter((k) => !placed.has(k));
  if (rest.length > 0) groups.push({ label: groups.length > 0 ? 'More' : 'Details', keys: rest });
  return groups;
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * The tabs for `room` px beside the first column, given each column's
 * natural width — or one tab with every column when they all fit.
 */
export function fitSegments(
  groups: ColumnGroup[],
  width: (key: string) => number,
  room: number,
): Omit<ColumnSegment, 'mark'>[] {
  const sum = (keys: string[]) => keys.reduce((n, k) => n + width(k), 0);
  const all = groups.flatMap((g) => g.keys);
  if (all.length === 0 || sum(all) <= room) return [{ id: all[0] ?? 'all', label: 'All', keys: all }];

  // A group wider than the room is cut into parts that fit, column by column
  type Part = { names: string[]; keys: string[]; whole: boolean };
  const parts: Part[] = [];
  for (const g of groups) {
    if (sum(g.keys) <= room) {
      parts.push({ names: [g.label], keys: g.keys, whole: true });
      continue;
    }
    const chunks: string[][] = [];
    for (const k of g.keys) {
      const last = chunks[chunks.length - 1];
      if (last && sum([...last, k]) <= room) last.push(k);
      else chunks.push([k]);
    }
    chunks.forEach((keys, i) => parts.push({ names: [`${g.label} ${i + 1}/${chunks.length}`], keys, whole: false }));
  }

  // Whole neighbouring groups that fit side by side share a tab
  const merged: Part[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && last.whole && p.whole && sum([...last.keys, ...p.keys]) <= room) {
      last.names.push(...p.names);
      last.keys.push(...p.keys);
    } else {
      merged.push({ names: [...p.names], keys: [...p.keys], whole: p.whole });
    }
  }
  return merged.map((p) => ({ id: p.keys[0]!, label: joinNames(p.names), keys: p.keys }));
}

/** A tab's dot: red when a value in its columns is wrong, orange when one is missing or to check. */
export function markOf(rows: NemoRow[], keys: string[]): ColumnSegment['mark'] {
  let mark: ColumnSegment['mark'] = null;
  const see = (c: NemoCell | undefined) => {
    if (c?.flag === 'error') mark = 'error';
    else if (c?.flag && mark === null) mark = 'check';
  };
  for (const r of rows) {
    for (const k of keys) {
      see(r.cells[k]);
      for (const item of r.items ?? []) see(item[k]);
      if (mark === 'error') return mark;
    }
  }
  return mark;
}
