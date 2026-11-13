/**
 * The CRT — ship certificates (spec 0084), by the rules of emsw.fi
 * (https://www.emsw.fi/en/crt-ship-certificates) and the declarant API:
 *
 * - emsw.fi asks for a CRT when a certificate is new, changed or not reported
 *   before. NEMO's certificate record cannot be read back by an API user, so
 *   NEMOLink reports **every valid certificate with every port call** (user
 *   decision 2026-09-26) — "the most recently submitted information remains
 *   valid", and ours is then the most recent.
 * - **One certificate of each type per port call**; NEMO takes one
 *   certificate per CRT message (ONLY_ONE_CERTIFICATE_IS_ALLOWED, 0065), so
 *   each certificate is its own CRT, with its own LRN.
 * - Each certificate needs its type, issue date, expiry (blank if none),
 *   issuer type and the issuer identification that type asks for
 *   (C-CRT-002/004/005); **attachments are required** — PDF, XML, JPG, PNG,
 *   10 MB each, each with a description, type ATT-037 (R-CRT-002).
 * - Ice class confirmation: a valid CL certificate sent with the request.
 *
 * Pure: the caller brings the certificates, the files, what we reported
 * before, and what NEMO's ship record showed when last read.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CertificateFact } from './nemo-ui-rules';
import { certToMig, type ShipCertificateRow } from './ship-master-data';

/** The certificate key: type and number, as the files are filed. */
export function certKey(c: { typeCode: string; certificateId: string | null }): string {
  return `${c.typeCode}:${c.certificateId ?? ''}`;
}

/** The six types Finland lists (emsw.fi); others are sent as they are. */
export const FI_CERTIFICATE_TYPES = ['CL', 'ISPS', 'LL', 'REG', 'TM', 'OTHER'] as const;

/** Issuer types (emsw.fi, C-CRT rules): what identifies the issuer for each. */
export const ISSUER_TYPES: Record<string, { words: string; needs: 'country' | 'id' | 'name' }> = {
  '01': { words: 'Flag state', needs: 'country' },
  '02': { words: 'Classification society', needs: 'id' },
  '03': { words: 'Recognized organization', needs: 'id' },
  '04': { words: 'Recognized security organization', needs: 'id' },
  '05': { words: 'Notified body', needs: 'name' },
  '06': { words: 'Insurance company', needs: 'name' },
  '99': { words: 'Other', needs: 'name' },
};

export interface CertFileFact {
  fileName: string;
  description: string;
  sha256: string;
}

export interface CertificateReportPlan {
  certKey: string;
  typeCode: string;
  /** Goes with this send. */
  willSend: boolean;
  /** Why not, in words — null when it goes. */
  reason: string | null;
  /** What must be fixed before it can go (empty when it is only unchanged). */
  gaps: string[];
  /** Already reported and unchanged: nothing to fix, nothing to send. */
  current: boolean;
  /** The crt:CRT payload (without the MAI envelope). */
  payload: Record<string, unknown> | null;
  files: CertFileFact[];
  /** Ask Traficom to confirm the ice class with this (CL) certificate. */
  iceClassConfirmation: boolean;
  /** Identity of what goes: the certificate's details and its files. */
  fingerprint: string;
}

export interface CertificateReportInput {
  certificates: ShipCertificateRow[];
  files: Map<string, CertFileFact[]>;
  /** certKey → fingerprint of our last accepted CRT for this ship. */
  reported: Record<string, string>;
  /** NEMO's certificates as last read (null = never read / not readable). */
  nemo: CertificateFact[] | null;
  /** The ship's stated ice class and NEMO's confirmation state (spec 0069). */
  iceClass: string | null;
  iceClassStatus: string | null;
  /** yyyy-mm-dd */
  today: string;
}

function effectiveExpiry(c: ShipCertificateRow): string | null {
  return c.extendedUntil ?? c.expiryDate ?? null;
}

/** What the certificate record lacks for NEMO (emsw.fi mandatory fields, C-CRT rules). */
export function certificateGaps(c: ShipCertificateRow): string[] {
  const gaps: string[] = [];
  if (!c.issueDate) gaps.push('issue date');
  const issuer = c.issuerTypeCode ? ISSUER_TYPES[c.issuerTypeCode] : undefined;
  if (!c.issuerTypeCode) gaps.push('issuer type');
  else if (issuer?.needs === 'country' && !c.issuerCountry) gaps.push('issuer flag state');
  else if (issuer?.needs === 'id' && !c.issuerId) gaps.push('issuer (from the list)');
  else if (issuer?.needs === 'name' && !c.issuer) gaps.push('issuer name');
  if ((c.typeCode === 'OTHER' || c.issuerTypeCode === '99') && !c.description) gaps.push('description');
  return gaps;
}

function payloadOf(c: ShipCertificateRow, files: CertFileFact[]): Record<string, unknown> {
  const cert = certToMig({
    typeCode: c.typeCode,
    ...(c.certificateId ? { certificateId: c.certificateId } : {}),
    ...(c.issueDate ? { issueDate: c.issueDate } : {}),
    ...(c.expiryDate ? { expiryDate: c.expiryDate } : {}),
    ...(c.extendedUntil ? { extendedUntil: c.extendedUntil } : {}),
    ...(c.description ? { description: c.description } : {}),
    ...(c.issuer ? { issuer: c.issuer } : {}),
    ...(c.issuerTypeCode ? { issuerTypeCode: c.issuerTypeCode } : {}),
    ...(c.issuerId ? { issuerId: c.issuerId } : {}),
    ...(c.issuerCountry ? { issuerCountry: c.issuerCountry } : {}),
  });
  if (typeof cert['ram:Description'] === 'string') {
    cert['ram:Description'] = { $: cert['ram:Description'], '@languageID': 'EN' };
  }
  return {
    'crt:ExchangedDocument': {
      'ram:AttachedSpecifiedBinaryFile': files.map((f) => ({
        'ram:FileName': f.fileName,
        'ram:TypeCode': 'ATT-037', // R-CRT-002: ship certificate
        'ram:Description': { $: f.description, '@languageID': 'EN' },
      })),
    },
    'crt:SpecifiedLogisticsTransportMovement': {
      'ram:UsedLogisticsTransportMeans': { 'ram:MaritimeApplicableSpecifiedCertificate': [cert] },
    },
  };
}

function fingerprintOf(c: ShipCertificateRow, files: CertFileFact[]): string {
  const facts = { c, files: files.map((f) => f.sha256).sort() };
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32);
}

export function planCertificateReports(input: CertificateReportInput): CertificateReportPlan[] {
  // One per type per port call: the newest of each type goes (latest expiry, then issue)
  const newestOfType = new Map<string, ShipCertificateRow>();
  for (const c of input.certificates) {
    const best = newestOfType.get(c.typeCode);
    const rank = (x: ShipCertificateRow) => `${effectiveExpiry(x) ?? '9999-12-31'}|${x.issueDate ?? ''}`;
    if (!best || rank(c) > rank(best)) newestOfType.set(c.typeCode, c);
  }

  return input.certificates.map((c) => {
    const key = certKey(c);
    const files = input.files.get(key) ?? [];
    const fingerprint = fingerprintOf(c, files);
    const base = { certKey: key, typeCode: c.typeCode, files, fingerprint, iceClassConfirmation: false };
    const no = (reason: string, gaps: string[] = [], current = false): CertificateReportPlan => ({
      ...base,
      willSend: false,
      reason,
      gaps,
      current,
      payload: null,
    });

    if (newestOfType.get(c.typeCode) !== c) {
      return no(`a newer ${c.typeCode} certificate goes instead — NEMO takes one of each type per port call`);
    }
    const expiry = effectiveExpiry(c);
    if (expiry && expiry < input.today) {
      return no(`expired ${expiry} — add the renewed certificate`, ['a valid certificate']);
    }
    const gaps = certificateGaps(c);
    if (files.length === 0) gaps.push('the certificate file (NEMO requires it)');
    if (gaps.length > 0) return no(`missing: ${gaps.join(', ')}`, gaps);

    // Every valid certificate goes with every call (user decision 2026-09-26):
    // NEMO's copy cannot be read back, so ours is restated each time
    const iceClassConfirmation =
      c.typeCode === 'CL' && !!input.iceClass && input.iceClass !== 'UKN' && input.iceClassStatus !== 'CONFIRMED';
    return {
      ...base,
      willSend: true,
      reason: null,
      gaps: [],
      current: false,
      payload: payloadOf(c, files),
      iceClassConfirmation,
    };
  });
}

/** A local reference number for a CRT (declarant API: unique, issued by the sender). */
export function newLrn(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(22);
  let out = '';
  for (let i = 0; i < 22; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
