/**
 * NEMO UI-only rules (docs/specs/0065): things the NEMO web UI tells an
 * operator that no API we read reports. Each rule is reproduced here from
 * the NEMO UI bundle, hard-coded, with its source named — so NEMOLink can
 * raise the same issue before NEMO's screen would. This is a catalogue of
 * functions, deliberately not a rules engine (user decision 2026-09-24):
 * adding a rule is a function, a catalogue entry, a test and a spec line.
 *
 * Two audiences share the same functions:
 *   - "In NEMO": run on the NSD snapshot (`ship.data.nemo`) → what NEMO's
 *     UI shows for the ship right now (`shipIssuesInNemo`).
 *   - "To NEMO": run on our own resolved data → what NEMO would show after
 *     we send (the CRT checklist in obligations.ts).
 */

export type NemoIssueLevel = 'warning' | 'info';

export interface NemoIssue {
  /** Catalogue id (NEMO_UI_RULES). */
  rule: string;
  level: NemoIssueLevel;
  /** Plain words (docs/07 law 2), always starting with what NEMO shows. */
  words: string;
  /** The codes concerned (certificate types), for the UI to highlight. */
  codes?: string[];
  /** Where to act on it, when the fix lives outside NEMOLink (the NEMO UI, spec 0067). */
  link?: string;
}

export interface CertificateFact {
  typeCode: string;
  /** ISO date or date-time; null/undefined = no expiry recorded. */
  expiryDate: string | null;
}

/**
 * The certificate types NEMO's ship view expects on every ship — the bundle
 * checks `["TM","REG","CL","LL","ISPS"]` one by one (port call view, key
 * "ship certificate expired") and `5 === shipCertificates.length` (ships
 * view). They are exactly the FI-preferred entries of the vendored
 * certificate_type list.
 */
export const NEMO_EXPECTED_CERTIFICATES = ['TM', 'REG', 'CL', 'LL', 'ISPS'] as const;

/** Ships view: "Expiring soon" when fewer than 30 days remain (bundle: `i<30`). */
export const NEMO_CERT_SOON_DAYS = 30;

const DAY = 86_400_000;

export interface CertificateGaps {
  /** Expected types with no certificate at all. */
  missing: string[];
  /** Types whose certificate has passed its expiry date. */
  expired: string[];
  /** Types whose certificate expires within NEMO_CERT_SOON_DAYS. */
  expiringSoon: string[];
}

/**
 * NEMO's certificate arithmetic, verbatim from the bundle: a type is missing
 * when no certificate carries it; a certificate with an expiry date is
 * expired when that date is in the past and "expiring soon" when fewer than
 * 30 days remain; a certificate without an expiry date is neither.
 */
export function certificateGaps(certs: CertificateFact[], now: number): CertificateGaps {
  const missing = NEMO_EXPECTED_CERTIFICATES.filter(
    (type) => !certs.some((c) => c.typeCode === type),
  );
  const expired: string[] = [];
  const expiringSoon: string[] = [];
  for (const c of certs) {
    if (!c.expiryDate) continue;
    const at = Date.parse(c.expiryDate);
    if (!Number.isFinite(at)) continue;
    const days = (at - now) / DAY;
    if (at < now) {
      if (!expired.includes(c.typeCode)) expired.push(c.typeCode);
    } else if (days < NEMO_CERT_SOON_DAYS) {
      if (!expiringSoon.includes(c.typeCode)) expiringSoon.push(c.typeCode);
    }
  }
  return { missing, expired, expiringSoon };
}

/** What NEMO's ice class pill says for an NSD ice class status (bundle keys "<Status> ice class"). */
export function iceClassStatusWords(status: string | null | undefined): string | null {
  switch ((status ?? '').toUpperCase()) {
    case 'UNCONFIRMED':
      return 'not valid (unconfirmed)';
    case 'PENDING':
      return 'pending confirmation';
    default:
      return null;
  }
}

/**
 * What to do about it (spec 0069): Traficom confirms an ice class; the
 * request travels with the CRT that carries the CL certificate
 * (`?requestIceClassConfirmation=true`, Declarant API 1.1.8). The fairway
 * dues follow the confirmed class, not the declared one.
 */
function iceClassNextStep(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'UNCONFIRMED':
      return (
        ' — Traficom confirms it once the classification certificate (CL) is sent in a CRT' +
        ' with the confirmation request; fairway dues follow the confirmed class'
      );
    case 'PENDING':
      return ' — Traficom is checking it';
    default:
      return '';
  }
}

export interface ShipInNemo {
  /** null = NSD did not know the ship when we looked. */
  shipId: string | null;
  certificates: CertificateFact[];
  iceClassStatus: string | null;
}

/** The issues NEMO's own screens show for this ship right now. */
export function shipIssuesInNemo(ship: ShipInNemo | null, now: number): NemoIssue[] {
  if (!ship || !ship.shipId) return [];
  const issues: NemoIssue[] = [];
  const gaps = certificateGaps(ship.certificates, now);
  if (gaps.missing.length > 0 || gaps.expired.length > 0) {
    const parts: string[] = [];
    if (gaps.missing.length > 0) parts.push(`missing ${gaps.missing.join(', ')}`);
    if (gaps.expired.length > 0) parts.push(`expired ${gaps.expired.join(', ')}`);
    issues.push({
      rule: 'ship-certificates',
      level: 'warning',
      words: `NEMO shows a ship certificate as missing or expired (${parts.join('; ')}) and asks for a CRT`,
      codes: [...gaps.missing, ...gaps.expired],
    });
  }
  if (gaps.expiringSoon.length > 0) {
    issues.push({
      rule: 'ship-certificate-expiring',
      level: 'info',
      words: `NEMO shows a certificate expiring within ${NEMO_CERT_SOON_DAYS} days (${gaps.expiringSoon.join(', ')})`,
      codes: gaps.expiringSoon,
    });
  }
  const ice = iceClassStatusWords(ship.iceClassStatus);
  if (ice) {
    issues.push({
      rule: 'ship-ice-class-status',
      level: 'info',
      words: `NEMO shows the ice class as ${ice}${iceClassNextStep(ship.iceClassStatus)}`,
    });
  }
  return issues;
}

/**
 * The CRT checklist for our side (obligations.ts): one line per expected
 * type, satisfied when the certificate is on file and not expired — what
 * NEMO's screens will say once the CRT is in.
 */
export function certificateChecklist(
  certs: CertificateFact[],
  now: number,
): { label: string; ok: boolean }[] {
  const gaps = certificateGaps(certs, now);
  return NEMO_EXPECTED_CERTIFICATES.map((type) => ({
    label: `${type} certificate on file and not expired`,
    ok: !gaps.missing.includes(type) && !gaps.expired.includes(type),
  }));
}

// ---- formality order and the customs confirmation (port call side) --------

/**
 * Which formalities NEMO wants submitted before another — the backend error
 * keys NOA_MUST_BE_SUBMITTED_BEFORE_ATA, DUE_MUST_BE_SUBMITTED_BEFORE_ATA,
 * NOD_MUST_BE_SUBMITTED_BEFORE_ATD, NOA_MUST_BE_SUBMITTED_BEFORE_SEC and
 * "SID must be submitted before SHP" (UI bundle), plus ATA before ATD from
 * the live ERR-021 "Departure time can not be before Arrival time" (0063).
 * The conditional "SID/SHP before other formalities" applies only while
 * SID/SHP drafts exist (NOA_CANNOT_BE_SEND_IF_SID_OR_SHP_DRAFT_FOUND) and is
 * not modelled here.
 */
export const FORMALITY_PREREQUISITES: Readonly<Record<string, readonly string[]>> = {
  ATA: ['NOA', 'DUE'],
  ATD: ['NOD', 'ATA'],
  SEC: ['NOA'],
  SHP: ['SID'],
};

/**
 * The customs confirmation a notice must carry before the actual can go:
 * ERR-003 "ATA cannot be submitted because the required declarant's official
 * confirmation … (DE-003-07) is missing from the NOA. The field value must
 * be FI-ST-01" (the codelist spells it ST-FI-01), and the NOD/ST-FI-02 twin
 * for the ATD (0063 §1, steps 5 and 8).
 */
export const CUSTOMS_CONFIRMATIONS: Readonly<
  Record<string, { notice: string; statement: string; words: string }>
> = {
  ATA: { notice: 'NOA', statement: 'ST-FI-01', words: 'Arrival confirmed to Customs in the NOA (ST-FI-01)' },
  ATD: { notice: 'NOD', statement: 'ST-FI-02', words: 'Departure confirmed to Customs in the NOD (ST-FI-02)' },
};

/**
 * The checklist lines a formality owes to NEMO's ordering before its own
 * data counts: the prerequisites sent, the notice confirmed. `submitted` and
 * `confirmed` are formality codes (0048 snapshot).
 */
export function prerequisiteChecklist(
  code: string,
  submitted: readonly string[],
  confirmed: readonly string[],
): { label: string; ok: boolean }[] {
  const items = (FORMALITY_PREREQUISITES[code] ?? []).map((pre) => ({
    label: `${pre} sent to NEMO`,
    ok: submitted.includes(pre),
  }));
  const confirmation = CUSTOMS_CONFIRMATIONS[code];
  if (confirmation) {
    items.push({ label: confirmation.words, ok: confirmed.includes(confirmation.notice) });
  }
  return items;
}

/** The catalogue — one entry per rule, naming where in NEMO's UI it was read. */
export const NEMO_UI_RULES: ReadonlyArray<{
  id: string;
  level: NemoIssueLevel;
  appliesTo: 'ship' | 'portCall';
  source: string;
}> = [
  {
    id: 'formality-order',
    level: 'warning',
    appliesTo: 'portCall',
    source:
      'NEMO UI bundle, backend error keys NOA_MUST_BE_SUBMITTED_BEFORE_ATA, DUE_MUST_BE_SUBMITTED_BEFORE_ATA, NOD_MUST_BE_SUBMITTED_BEFORE_ATD, NOA_MUST_BE_SUBMITTED_BEFORE_SEC, SID before SHP; ATA before ATD from live ERR-021 (spec 0063)',
  },
  {
    id: 'customs-confirmation',
    level: 'warning',
    appliesTo: 'portCall',
    source:
      'NEMO UI bundle, ATA form: live ERR-003 (NOA must carry ST-FI-01 before the ATA; NOD must carry ST-FI-02 before the ATD), spec 0063',
  },
  {
    id: 'ship-certificates',
    level: 'warning',
    appliesTo: 'ship',
    source:
      'NEMO UI bundle, port call view: key "ship certificate expired" — any of TM, REG, CL, LL, ISPS absent from the NSD shipCertificates, or any certificateDateOfExpiry in the past',
  },
  {
    id: 'ship-certificate-expiring',
    level: 'info',
    appliesTo: 'ship',
    source: 'NEMO UI bundle, ships view: "Expiring soon" when a certificate expires in under 30 days',
  },
  {
    id: 'ship-ice-class-status',
    level: 'info',
    appliesTo: 'ship',
    source:
      'NEMO UI bundle, port call view: NSD iceClass.status rendered as "Ei voimassa" (UNCONFIRMED), "Odottaa" (PENDING), "Voimassa" (CONFIRMED); ' +
      'Declarant API 1.1.8: the confirmation is requested with the CRT carrying the CL certificate, ?requestIceClassConfirmation=true, and Traficom confirms (spec 0069)',
  },
];
