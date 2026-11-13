/**
 * Certificate files (spec 0084): NEMO's formats sniffed from the bytes, 10 MB,
 * a description each, stored through the FileStore, audited.
 */
import { BadRequestException } from '@nestjs/common';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import { CertificateFilesService, cleanFileName, sniffCertificateType } from '../src/admin/certificate-files.service';
import type { ShipsService } from '../src/admin/ships.service';
import type { FileStore } from '../src/files/file-store';
import type { TenantDb } from '../src/tenancy/tenant-db';

const ADMIN = { username: 'admin@fleetco.example', orgSlug: 'fleetco' } as SessionUser;
const PDF = Buffer.from('%PDF-1.7\n...');

function harness(existing = 0) {
  const sql: { text: string; params?: unknown[] }[] = [];
  const query = jest.fn(async (text: string, params?: unknown[]) => {
    sql.push({ text, params });
    if (text.includes('INSERT INTO ship_certificate_file')) {
      return { rows: [{ id: 'f-1', cert_key: 'CL:CL-1', file_name: params![2], description: params![3], content_type: params![4], byte_size: params![5], sha256: params![6], uploaded_by: params![10], created: new Date('2026-09-26T10:00:00Z'), storage: params![7], storage_key: params![8], content: null }] };
    }
    if (text.includes('FROM ship_certificate_file')) return { rows: Array.from({ length: existing }, () => ({})) };
    return { rows: [] };
  });
  const client = { query };
  const tenantDb = {
    schemaFor: jest.fn(async () => 'org_fleetco'),
    withOrg: jest.fn(async (_s: string, fn: (c: unknown) => Promise<unknown>) => fn(client)),
  } as unknown as TenantDb;
  const content = jest.fn(async () => 'audit-1');
  const ships = { get: jest.fn(async () => ({ certificates: [{ typeCode: 'CL', certificateId: 'CL-1' }] })) } as unknown as ShipsService;
  const put = jest.fn(async () => ({ storage: 's3' as const, storageKey: 'org/fleetco/ships/s/certificates/x.pdf', content: null }));
  const store = { put, get: jest.fn(), remove: jest.fn() } as unknown as FileStore;
  return { service: new CertificateFilesService(tenantDb, { content } as unknown as AuditService, ships, store), sql, content, put };
}

describe('certificate files (spec 0084)', () => {
  it('sniffs the four formats NEMO takes, from the bytes', () => {
    expect(sniffCertificateType(PDF)).toEqual({ contentType: 'application/pdf', ext: 'pdf' });
    expect(sniffCertificateType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))!.ext).toBe('png');
    expect(sniffCertificateType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))!.ext).toBe('jpg');
    expect(sniffCertificateType(Buffer.from('<?xml version="1.0"?><cert/>'))!.ext).toBe('xml');
    expect(sniffCertificateType(Buffer.from('PK\u0003\u0004 a zip'))).toBeNull();
  });

  it('names the file by what it really is, without a path or odd characters', () => {
    expect(cleanFileName('C:\\scans\\CL cert (2024).PDF', 'pdf')).toBe('CL cert _2024_.pdf');
    expect(cleanFileName('photo.jpeg.exe', 'jpg')).toBe('photo.jpeg.jpg');
  });

  it('stores the bytes through the FileStore, keeps the metadata, audits, and describes the file by default', async () => {
    const h = harness();
    const row = await h.service.upload(ADMIN, 'ship-1', 'CL:CL-1', { originalname: 'cl.pdf', buffer: PDF, size: PDF.length });
    expect(h.put).toHaveBeenCalledWith('fleetco', 'ships/ship-1/certificates', 'pdf', PDF, 'application/pdf');
    expect(row).toMatchObject({ fileName: 'cl.pdf', description: 'CL certificate CL-1', contentType: 'application/pdf' });
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'certificate_file_added', storage: 's3' }) }),
      expect.anything(),
    );
  });

  it('refuses what NEMO would refuse: another format, over 10 MB, a certificate the ship lacks, a sixth file', async () => {
    await expect(harness().service.upload(ADMIN, 'ship-1', 'CL:CL-1', { originalname: 'x.zip', buffer: Buffer.from('PK..'), size: 4 })).rejects.toThrow(/PDF, XML, JPG or PNG/);
    await expect(harness().service.upload(ADMIN, 'ship-1', 'CL:CL-1', { originalname: 'x.pdf', buffer: PDF, size: 11 * 1024 * 1024 })).rejects.toThrow(/10 MB/);
    await expect(harness().service.upload(ADMIN, 'ship-1', 'LL:9', { originalname: 'x.pdf', buffer: PDF, size: PDF.length })).rejects.toBeInstanceOf(BadRequestException);
    await expect(harness(5).service.upload(ADMIN, 'ship-1', 'CL:CL-1', { originalname: 'x.pdf', buffer: PDF, size: PDF.length })).rejects.toThrow(/at most 5 files/);
  });
});
