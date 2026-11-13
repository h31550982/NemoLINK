/**
 * The CRT — ship certificates (spec 0084): emsw.fi's rules, the payload that
 * passes the vendored MIG schema, one certificate per type, the gaps said.
 */
import { certificateGaps, newLrn, planCertificateReports, type CertFileFact } from '../src/canonical/certificate-report';
import type { ShipCertificateRow } from '../src/canonical/ship-master-data';
import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';
import { MigValidator } from '../src/nemo-client/mig-validator';

const CL: ShipCertificateRow = {
  typeCode: 'CL',
  certificateId: 'CL-123',
  issueDate: '2024-01-10',
  expiryDate: '2029-01-09',
  extendedUntil: null,
  description: null,
  issuer: null,
  issuerTypeCode: '02',
  issuerId: 'DNV',
  issuerCountry: null,
};
const REG: ShipCertificateRow = { ...CL, typeCode: 'REG', certificateId: 'R-9', issuerTypeCode: '01', issuerId: null, issuerCountry: 'FI' };
const FILE: CertFileFact = { fileName: 'cl.pdf', description: 'CL certificate CL-123', sha256: 'aa' };

function plan(certs: ShipCertificateRow[], files: Record<string, CertFileFact[]>, extra: Partial<Parameters<typeof planCertificateReports>[0]> = {}) {
  return planCertificateReports({
    certificates: certs,
    files: new Map(Object.entries(files)),
    reported: {},
    nemo: null,
    iceClass: null,
    iceClassStatus: null,
    today: '2026-09-26',
    ...extra,
  });
}

describe('CRT planning (spec 0084)', () => {
  it('a complete certificate with its file goes, and its envelope passes the MIG schema', () => {
    const [p] = plan([CL], { 'CL:CL-123': [FILE] });
    expect(p).toMatchObject({ certKey: 'CL:CL-123', willSend: true, reason: null, gaps: [] });
    const env = buildMaiEnvelope({
      formalityType: 'CRT',
      declarant: { id: 'FI1471406-3', roleCode: 'AG' },
      visitId: 'FI20260925-024-2',
      payload: p!.payload!,
      declarationId: newLrn(),
    });
    expect(new MigValidator().validate('CRT', env)).toEqual([]);
    const doc = (p!.payload!['crt:ExchangedDocument'] as Record<string, unknown[]>)['ram:AttachedSpecifiedBinaryFile']!;
    expect(doc).toEqual([{ 'ram:FileName': 'cl.pdf', 'ram:TypeCode': 'ATT-037', 'ram:Description': { $: 'CL certificate CL-123', '@languageID': 'EN' } }]);
  });

  it('every valid certificate goes with every call — even one reported before, unchanged (user decision)', () => {
    const first = plan([CL], { 'CL:CL-123': [FILE] });
    const again = plan([CL], { 'CL:CL-123': [FILE] }, { reported: { 'CL:CL-123': first[0]!.fingerprint } });
    expect(again[0]!.willSend).toBe(true);
  });

  it('NEMO requires the file: without one the certificate waits, and says so', () => {
    const [p] = plan([CL], {});
    expect(p).toMatchObject({ willSend: false, gaps: ['the certificate file (NEMO requires it)'] });
  });

  it('the issuer identification follows the issuer type (C-CRT-002/004/005)', () => {
    expect(certificateGaps({ ...CL, issueDate: null, issuerTypeCode: null })).toEqual(['issue date', 'issuer type']);
    expect(certificateGaps({ ...CL, issuerId: null })).toEqual(['issuer (from the list)']);
    expect(certificateGaps({ ...REG, issuerCountry: null })).toEqual(['issuer flag state']);
    expect(certificateGaps({ ...CL, issuerTypeCode: '06', issuerId: null })).toEqual(['issuer name']);
    expect(certificateGaps({ ...CL, typeCode: 'OTHER' })).toEqual(['description']);
  });

  it('one of each type per port call: the newest goes, the older says why', () => {
    const older = { ...CL, certificateId: 'CL-OLD', expiryDate: '2027-01-01' };
    const out = plan([older, CL], { 'CL:CL-OLD': [FILE], 'CL:CL-123': [FILE] });
    expect(out.find((p) => p.certKey === 'CL:CL-123')!.willSend).toBe(true);
    expect(out.find((p) => p.certKey === 'CL:CL-OLD')).toMatchObject({ willSend: false, reason: expect.stringMatching(/one of each type/) });
  });

  it('an expired certificate does not go', () => {
    const [p] = plan([{ ...CL, expiryDate: '2025-01-01' }], { 'CL:CL-123': [FILE] });
    expect(p).toMatchObject({ willSend: false, reason: 'expired 2025-01-01 — add the renewed certificate' });
  });

  it('the CL certificate asks Traficom to confirm the ice class until NEMO shows it confirmed', () => {
    const files = { 'CL:CL-123': [FILE], 'REG:R-9': [FILE] };
    const asked = plan([CL, REG], files, { iceClass: 'FS1A', iceClassStatus: 'UNCONFIRMED' });
    expect(asked.map((p) => p.iceClassConfirmation)).toEqual([true, false]);
    expect(plan([CL], files, { iceClass: 'FS1A', iceClassStatus: 'CONFIRMED' })[0]!.iceClassConfirmation).toBe(false);
    expect(plan([CL], files, { iceClass: null })[0]!.iceClassConfirmation).toBe(false);
  });

  it('an LRN is 22 characters of A–Z and 0–9, fresh each time', () => {
    const a = newLrn();
    expect(a).toMatch(/^[A-Z0-9]{22}$/);
    expect(newLrn()).not.toBe(a);
  });
});
