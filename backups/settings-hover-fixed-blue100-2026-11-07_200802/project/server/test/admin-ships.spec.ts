/**
 * Spec 0020 — ship certificates: vendored enum, MIG-key storage mapping.
 */
import type { PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import {
  CERTIFICATE_TYPE_CODES,
  shipCertificateSchema,
  shipUpdateSchema,
} from '../src/admin/ship.schema';
import { ShipsService } from '../src/admin/ships.service';
import type { NemoClientService } from '../src/nemo-client/nemo-client.service';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const CERT_KEY = 'ram:MaritimeApplicableSpecifiedCertificate';

function makeService(clientQuery: jest.Mock) {
  const client = { query: clientQuery } as unknown as PoolClient;
  const content = jest.fn().mockResolvedValue('audit-1');
  const tenantDb = {
    schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
    withOrg: jest.fn(
      async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client),
    ),
  } as unknown as TenantDb;
  const service = new ShipsService(tenantDb, { content } as unknown as AuditService, {} as unknown as NemoClientService);
  return { service, content };
}

function dbRow(data: Record<string, unknown>) {
  return {
    id: 'v1',
    name: 'MS Test',
    imo_number: '1234567',
    mmsi: null,
    call_sign: null,
    is_active: true,
    created: new Date('2026-08-22T10:00:00Z'),
    updated: new Date('2026-08-22T11:00:00Z'),
    author_org: 'acmeship',
    data,
    // in the org's fleet (spec 0068)
    fleet_id: 'f1',
    fleet_since: new Date('2026-08-22T11:00:00Z'),
    fleet_author: 'admin@acmeship.example',
    fleet_source: 'admin-ui',
    fleet_data: {},
  };
}

describe('certificate type enum from the embedded CRT schema (spec 0020 AC 2)', () => {
  it('is non-empty and vendored (contains BWM, ISPS, OTHER)', () => {
    expect(CERTIFICATE_TYPE_CODES.size).toBeGreaterThan(50);
    expect(CERTIFICATE_TYPE_CODES.has('BWM')).toBe(true);
    expect(CERTIFICATE_TYPE_CODES.has('ISPS')).toBe(true);
    expect(CERTIFICATE_TYPE_CODES.has('OTHER')).toBe(true);
  });
});

describe('certificate validation (spec 0020 AC 1)', () => {
  it('accepts a full valid certificate', () => {
    expect(
      shipCertificateSchema.safeParse({
        typeCode: 'BWM',
        certificateId: 'BWM-2026-001',
        issueDate: '2026-01-15',
        expiryDate: '2027-01-15',
        issuer: 'DNV',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown type codes, bad dates, unknown keys', () => {
    expect(shipCertificateSchema.safeParse({ typeCode: 'NOPE' }).success).toBe(false);
    expect(
      shipCertificateSchema.safeParse({ typeCode: 'BWM', expiryDate: '15.1.2027' })
        .success,
    ).toBe(false);
    expect(
      shipCertificateSchema.safeParse({ typeCode: 'BWM', extra: 1 }).success,
    ).toBe(false);
  });

  it('update accepts certificates array and [] to clear', () => {
    expect(
      shipUpdateSchema.safeParse({ certificates: [{ typeCode: 'LL' }] }).success,
    ).toBe(true);
    expect(shipUpdateSchema.safeParse({ certificates: [] }).success).toBe(true);
  });

  it('refuses an issue date in the future and an expiry before the issue (spec 0086 amendment)', () => {
    const cert = (c: Record<string, string>) => shipUpdateSchema.safeParse({ certificates: [{ typeCode: 'CL', ...c }] }).success;
    expect(cert({ issueDate: '2099-01-01' })).toBe(false);
    expect(cert({ issueDate: '2026-01-10', expiryDate: '2026-01-09' })).toBe(false);
    expect(cert({ issueDate: '2026-01-10', expiryDate: '2026-01-10' })).toBe(true);
    expect(cert({ expiryDate: '2020-01-01' })).toBe(true);
  });
});

describe('MIG-key storage mapping (spec 0020 AC 1)', () => {
  it('create stores certificates under the MIG spelling, issuer nested', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [dbRow({})] });
    const { service } = makeService(query);
    await service.create(ADMIN, {
      name: 'MS Test',
      certificates: [
        { typeCode: 'BWM', expiryDate: '2027-01-15', issuer: 'DNV' },
      ],
    });
    const stored = JSON.parse(query.mock.calls[0][1][4]);
    expect(stored[CERT_KEY]).toEqual([
      {
        'ram:TypeCode': 'BWM',
        'ram:ExpiryDate': '2027-01-15',
        'ram:IssuerCertificateIssuerParty': { 'ram:Name': 'DNV' },
      },
    ]);
  });

  it('update replaces the set only when certificates is present', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [dbRow({})] });
    const { service } = makeService(query);

    // Since spec 0032 every update reads the row first (FOR UPDATE), so
    // the UPDATE statement is the second call of each service call.
    await service.update(ADMIN, 'v1', { name: 'MS X' });
    // the master already names the ship: the edit is the org's override on its
    // fleet row, the shared record untouched (spec 0086)
    expect(query.mock.calls[1][0]).toContain('UPDATE fleet_ship');
    expect(JSON.parse(query.mock.calls[1][1][1]).overrides.name).toMatchObject({ value: 'MS X' });

    await service.update(ADMIN, 'v1', { certificates: [] });
    // each update = read, UPDATE, read back; the cert set is cleared in the data
    expect(query.mock.calls[4][0]).toContain('UPDATE platform.ship');
    expect(JSON.parse(query.mock.calls[4][1][9])).toEqual({ [CERT_KEY]: [] });
  });

  it('rows map MIG-keyed data back to the wire shape', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        dbRow({
          [CERT_KEY]: [
            {
              'ram:TypeCode': 'LL',
              'ram:ID': 'LL-1',
              'ram:IssueDate': '2025-06-01',
              'ram:ExpiryDate': '2026-06-01',
              'ram:ValidityExtendedUntilDate': '2026-09-01',
              'ram:IssuerCertificateIssuerParty': {
                'ram:Name': 'Traficom',
                'ram:ID': 'TRAFI',
                'ram:TypeCode': 'FS',
                'ram:PostalTradeAddress': { 'ram:CountryID': 'FI' },
              },
            },
          ],
        }),
      ],
    });
    const { service } = makeService(query);
    const rows = await service.list(ADMIN);
    expect(rows[0]!.updated).toBe('2026-08-22T11:00:00.000Z');
    expect(rows[0]!.certificates).toEqual([
      {
        typeCode: 'LL',
        certificateId: 'LL-1',
        issueDate: '2025-06-01',
        expiryDate: '2026-06-01',
        extendedUntil: '2026-09-01',
        description: null,
        issuer: 'Traficom',
        // The issuer elements the FI profile makes mandatory (DE-006-06/07/08)
        issuerTypeCode: 'FS',
        issuerId: 'TRAFI',
        issuerCountry: 'FI',
      },
    ]);
  });
});

describe('particulars on the admin API (spec 0036 AC 1)', () => {
  it('update merges particulars into data and audits the field diff', async () => {
    const existing = { shipData: { owner_name: 'Old Owner Oy' } };
    const after = {
      shipData: { owner_name: 'Old Owner Oy', grossweight: 4990 },
      iceClass: { code: 'FS1A' },
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [dbRow(existing)] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [dbRow(after)] });
    const { service, content } = makeService(query);
    await service.update(ADMIN, 'v1', {
      particulars: { grossWeight: 4990, iceClass: { code: 'FS1A' } },
    });
    const stored = JSON.parse(query.mock.calls[1][1][9]);
    expect(stored.shipData).toEqual({ owner_name: 'Old Owner Oy', grossweight: 4990 });
    expect(stored.iceClass).toEqual({ code: 'FS1A' });
    expect(content.mock.calls[0][0].data.changes).toEqual({
      grossWeight: { from: null, to: 4990 },
      iceClass: { from: null, to: { code: 'FS1A' } },
    });
  });

  it('rows expose the wire-shaped particulars', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        dbRow({
          shipData: { owner_name: 'Acmeship Oy', typeCode: '150' },
          'ram:InertGasSystemIndicator': 1,
        }),
      ],
    });
    const { service } = makeService(query);
    const rows = await service.list(ADMIN);
    expect(rows[0]!.particulars).toEqual({
      ownerName: 'Acmeship Oy',
      typeCode: '150',
      inertGasSystem: true,
    });
  });
});

describe('the override column holds only overrides (spec 0086)', () => {
  it('an empty master field is filled in place — the shared record gains the value', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [dbRow({})] });
    const { service } = makeService(query);
    await service.update(ADMIN, 'v1', { mmsi: '230666669' });
    expect(query.mock.calls[1][0]).toContain('UPDATE platform.ship');
    expect(query.mock.calls[1][1][4]).toBe('230666669');
  });

  it('a certificate\'s own expiry is not External: a changed date is edited in place, no override (spec 0086 amendment)', async () => {
    const master = { [CERT_KEY]: [{ 'ram:TypeCode': 'CL', 'ram:ID': 'CL-1', 'ram:ExpiryDate': '2029-01-01' }] };
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [dbRow(master)] });
    const { service } = makeService(query);
    await service.update(ADMIN, 'v1', { certificates: [{ typeCode: 'CL', certificateId: 'CL-1', expiryDate: '2030-06-30' }] });
    const fleet = query.mock.calls.find((c: unknown[]) => String(c[0]).includes('UPDATE fleet_ship'));
    if (fleet) expect(JSON.parse(fleet[1][1]).overrides ?? {}).toEqual({});
    const ship = query.mock.calls.find((c: unknown[]) => String(c[0]).includes('UPDATE platform.ship'));
    expect(ship).toBeDefined();
    expect(JSON.stringify(ship![1])).toContain('2030-06-30');
  });
});
