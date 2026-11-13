/**
 * The read-back (spec 0089): after a send, NEMO's own copy of the
 * formality — `GET /v1/portcalls/{visitId}/formalities` returns the full
 * envelope NEMO holds for each submitted formality (live, spec 0063) — is
 * compared with what we sent, leaf by leaf. NEMO may add elements (its own
 * MAI carries more of the declarant); only what we sent is checked, so an
 * addition is not a difference, a missing or changed value is.
 */

export interface HeldDifference {
  /** JSON path under the data section, e.g. ram:CrewQuantity. */
  path: string;
  sent: unknown;
  held: unknown;
}

export interface ReadBack {
  /** same: NEMO holds what we sent · differs: some values differ · missing: NEMO lists no such formality · unread: the list could not be read. */
  state: 'same' | 'differs' | 'missing' | 'unread';
  differences: HeldDifference[];
  /** NEMO's status for it, e.g. SUBMITTED. */
  status: string | null;
  readAt: string;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function sameLeaf(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  // Times may come back normalised (milliseconds, offset): the same instant is the same value
  if (typeof a === 'string' && typeof b === 'string' && ISO_TIME.test(a) && ISO_TIME.test(b)) {
    return Date.parse(a) === Date.parse(b);
  }
  // A number may come back as its string and the other way round
  return String(a) === String(b);
}

/** Every leaf of `sent` must be in `held` with the same value; additions in `held` are fine. */
export function compareHeld(sent: unknown, held: unknown, path = ''): HeldDifference[] {
  if (sent === null || typeof sent !== 'object') {
    return sameLeaf(sent, held) ? [] : [{ path: path || '(root)', sent, held: held ?? null }];
  }
  const out: HeldDifference[] = [];
  if (Array.isArray(sent)) {
    const list = Array.isArray(held) ? held : held === undefined || held === null ? [] : [held];
    sent.forEach((item, i) => out.push(...compareHeld(item, list[i], `${path}[${i}]`)));
    return out;
  }
  const obj = held && typeof held === 'object' && !Array.isArray(held) ? (held as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(sent as Record<string, unknown>)) {
    out.push(...compareHeld(value, obj[key], path ? `${path}/${key}` : key));
  }
  return out;
}

/** The data section of an envelope: the object at `<t>:<TYPE>`, e.g. noa:NOA. */
export function dataSectionOf(envelope: Record<string, unknown>, type: string): unknown {
  const env = (envelope['env:Envelope'] ?? envelope) as Record<string, unknown>;
  return env[`${type.toLowerCase()}:${type}`] ?? null;
}

/**
 * Finds our formality in NEMO's list — by NEMO's outer id when we have it,
 * else by our document id — and compares its data section with ours.
 */
export function readBackOf(
  list: unknown,
  type: string,
  sentEnvelope: Record<string, unknown>,
  ids: { formalityId: string | null; documentId: string | null },
  documentIdOf: (envelope: Record<string, unknown>) => string | null,
  now = new Date(),
): ReadBack {
  const readAt = now.toISOString();
  if (!Array.isArray(list)) return { state: 'unread', differences: [], status: null, readAt };
  const items = list
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .filter((x) => x['formalityType'] === type);
  const found =
    (ids.formalityId ? items.find((x) => x['formalityId'] === ids.formalityId) : undefined) ??
    (ids.documentId
      ? items.find((x) => documentIdOf((x['formality'] ?? {}) as Record<string, unknown>) === ids.documentId)
      : undefined);
  if (!found) return { state: 'missing', differences: [], status: null, readAt };
  const held = dataSectionOf((found['formality'] ?? {}) as Record<string, unknown>, type);
  const differences = compareHeld(dataSectionOf(sentEnvelope, type), held);
  return {
    state: differences.length === 0 ? 'same' : 'differs',
    differences,
    status: typeof found['status'] === 'string' ? found['status'] : null,
    readAt,
  };
}
