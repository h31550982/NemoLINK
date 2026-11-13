/**
 * Hub locations dataset (docs/specs/0027): the hub publishes the complete
 * worldwide LOCODE set (EMSA-portal mirror) as one JSON file —
 * `{ locodes: [{ locode, locationName, portFacilityCodes, anchorages,
 * portAreas }] }`, ~115k entries. Parsing is pure and lenient per entry
 * (a malformed entry is counted as skipped, never breaks the run) but
 * strict on the overall shape.
 */

export interface HubLocationRow {
  locode: string;
  name: string | null;
  country: string | null;
  /** Areas/facilities/anchorages only where non-empty — `{}` for plain rows. */
  data: Record<string, unknown>;
}

export interface HubLocationsParse {
  rows: HubLocationRow[];
  received: number;
  skipped: number;
}

export function parseHubLocations(raw: string): HubLocationsParse {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error('locations source is not valid JSON');
  }
  const locodes = (doc as { locodes?: unknown }).locodes;
  if (!Array.isArray(locodes) || locodes.length === 0) {
    throw new Error('locations source has no locodes array');
  }

  // Last row wins per locode: the multi-row upsert must not see one key twice.
  const byLocode = new Map<string, HubLocationRow>();
  let skipped = 0;
  for (const raw of locodes) {
    const entry = raw as Record<string, unknown>;
    const locode = typeof entry.locode === 'string' ? entry.locode.trim() : '';
    if (!locode) {
      skipped++;
      continue;
    }
    const name =
      typeof entry.locationName === 'string' && entry.locationName.trim()
        ? entry.locationName.trim()
        : null;
    const country = /^[A-Z]{2}/.test(locode) ? locode.slice(0, 2) : null;
    const data: Record<string, unknown> = {};
    for (const key of ['portAreas', 'portFacilityCodes', 'anchorages'] as const) {
      const value = entry[key];
      if (Array.isArray(value) && value.length > 0) data[key] = value;
    }
    byLocode.set(locode, { locode, name, country, data });
  }
  if (byLocode.size === 0) {
    throw new Error('locations source yielded no usable entries');
  }
  return { rows: [...byLocode.values()], received: locodes.length, skipped };
}
