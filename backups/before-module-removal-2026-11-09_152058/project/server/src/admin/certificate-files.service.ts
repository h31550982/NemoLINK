/**
 * The certificate files an organisation keeps for its ships (spec 0084): the
 * copies NEMO's CRT carries as attachments. emsw.fi: attachments are required,
 * PDF, XML, JPG or PNG, max 10 MB each, a description each; several files may
 * go with one certificate (the CL certificate and its annex). Sniffed from the
 * bytes, never trusted from the name. Bytes in the files bucket (FileStore).
 */
import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/session.service';
import { FileStore } from '../files/file-store';
import { TenantDb } from '../tenancy/tenant-db';
import { ShipsService } from './ships.service';

/** NEMO's limit on a CRT attachment (declarant API 1.1.8, emsw.fi). */
export const CERT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Files per certificate — a certificate and its annexes, not an archive. */
export const CERT_FILES_MAX = 5;

/** The certificate a file belongs to: its type and number, as the master record keys it. */
export function certKeyOf(typeCode: string, certificateId: string | null | undefined): string {
  return `${typeCode}:${certificateId ?? ''}`;
}

export interface CertificateFileRow {
  id: string;
  certKey: string;
  fileName: string;
  description: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string;
  created: string;
}

export interface CertificateFileContent {
  fileName: string;
  description: string;
  contentType: string;
  content: Buffer;
}

/** What the bytes are, in the content types NEMO accepts; null when none of them. */
export function sniffCertificateType(buf: Buffer): { contentType: string; ext: string } | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return { contentType: 'application/pdf', ext: 'pdf' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return { contentType: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
  const head = buf.subarray(0, 256).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<?xml') || /^<[A-Za-z]/.test(head)) return { contentType: 'application/xml', ext: 'xml' };
  return null;
}

/** A safe file name NEMO will take: the extension it really is, no path, no odd characters. */
export function cleanFileName(original: string, ext: string): string {
  const base = original
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .trim()
    .slice(0, 100);
  return `${base || 'certificate'}.${ext}`;
}

interface FileDbRow {
  id: string;
  cert_key: string;
  file_name: string;
  description: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  uploaded_by: string;
  created: Date;
  storage: 's3' | 'db';
  storage_key: string | null;
  content: Buffer | null;
}

function rowOf(x: FileDbRow): CertificateFileRow {
  return {
    id: x.id,
    certKey: x.cert_key,
    fileName: x.file_name,
    description: x.description,
    contentType: x.content_type,
    byteSize: x.byte_size,
    sha256: x.sha256,
    uploadedBy: x.uploaded_by,
    created: x.created.toISOString(),
  };
}

@Injectable()
export class CertificateFilesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly ships: ShipsService,
    private readonly store: FileStore,
  ) {}

  async list(viewer: SessionUser, shipId: string): Promise<CertificateFileRow[]> {
    await this.ships.get(viewer, shipId); // in the viewer's reach, or 404
    return (await this.rowsOf(viewer.orgSlug, shipId)).map(rowOf);
  }

  private async rowsOf(orgSlug: string, shipId: string, certKey?: string): Promise<FileDbRow[]> {
    const r = await this.tenantDb.withOrg(orgSlug, (client) =>
      client.query<FileDbRow>(
        `SELECT id, cert_key, file_name, description, content_type, byte_size, sha256, uploaded_by, created,
                storage, storage_key, NULL::bytea AS content
           FROM ship_certificate_file
          WHERE ship_id = $1 AND is_active AND ($2::text IS NULL OR cert_key = $2)
          ORDER BY cert_key, created`,
        [shipId, certKey ?? null],
      ),
    );
    return r.rows;
  }

  async upload(
    viewer: SessionUser,
    shipId: string,
    certKey: string,
    file: { originalname: string; buffer: Buffer; size: number },
    description?: string,
  ): Promise<CertificateFileRow> {
    const ship = await this.ships.get(viewer, shipId);
    const cert = ship.certificates.find((c) => certKeyOf(c.typeCode, c.certificateId) === certKey);
    if (!cert) throw new BadRequestException('No such certificate on this ship');
    if (file.size > CERT_FILE_MAX_BYTES) throw new BadRequestException('NEMO takes certificate files up to 10 MB');
    const kind = sniffCertificateType(file.buffer);
    if (!kind) throw new BadRequestException('NEMO takes certificate files as PDF, XML, JPG or PNG');
    const existing = await this.rowsOf(viewer.orgSlug, shipId, certKey);
    if (existing.length >= CERT_FILES_MAX) {
      throw new BadRequestException(`A certificate carries at most ${CERT_FILES_MAX} files — remove an old one first`);
    }
    const fileName = cleanFileName(file.originalname, kind.ext);
    // emsw.fi: each attachment needs a description — the certificate's own words by default
    const words = (description ?? '').trim().slice(0, 200) || `${cert.typeCode} certificate${cert.certificateId ? ` ${cert.certificateId}` : ''}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const stored = await this.store.put(viewer.orgSlug, `ships/${shipId}/certificates`, kind.ext, file.buffer, kind.contentType);
    const schema = await this.tenantDb.schemaFor(viewer.orgSlug);
    const row = await this.tenantDb.withOrg(viewer.orgSlug, async (client) => {
      const inserted = await client.query<FileDbRow>(
        `INSERT INTO ship_certificate_file
           (ship_id, cert_key, file_name, description, content_type, byte_size, sha256, storage, storage_key, content, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, cert_key, file_name, description, content_type, byte_size, sha256, uploaded_by, created,
                   storage, storage_key, NULL::bytea AS content`,
        [shipId, certKey, fileName, words, kind.contentType, file.size, sha256, stored.storage, stored.storageKey, stored.content, viewer.username],
      );
      await this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'ship',
          entityId: shipId,
          data: { action: 'certificate_file_added', certKey, fileName, byteSize: file.size, sha256, storage: stored.storage },
          schema,
        },
        client,
      );
      return inserted.rows[0]!;
    });
    return rowOf(row);
  }

  async file(viewer: SessionUser, shipId: string, fileId: string): Promise<CertificateFileContent> {
    await this.ships.get(viewer, shipId);
    const r = await this.tenantDb.withOrg(viewer.orgSlug, (client) =>
      client.query<FileDbRow>(
        `SELECT * FROM ship_certificate_file WHERE id = $1 AND ship_id = $2 AND is_active`,
        [fileId, shipId],
      ),
    );
    const x = r.rows[0];
    if (!x) throw new NotFoundException('No such file');
    return { fileName: x.file_name, description: x.description, contentType: x.content_type, content: await this.store.get({ storage: x.storage, storageKey: x.storage_key, content: x.content }) };
  }

  /** For the CRT send: every active file of one certificate, with its bytes. */
  async contentsOf(orgSlug: string, shipId: string, certKey: string): Promise<CertificateFileContent[]> {
    const r = await this.tenantDb.withOrg(orgSlug, (client) =>
      client.query<FileDbRow>(
        `SELECT * FROM ship_certificate_file WHERE ship_id = $1 AND cert_key = $2 AND is_active ORDER BY created`,
        [shipId, certKey],
      ),
    );
    const out: CertificateFileContent[] = [];
    for (const x of r.rows) {
      out.push({
        fileName: x.file_name,
        description: x.description,
        contentType: x.content_type,
        content: await this.store.get({ storage: x.storage, storageKey: x.storage_key, content: x.content }),
      });
    }
    return out;
  }

  /** The files per certificate, without bytes — the preview and the checks. */
  async summaryOf(orgSlug: string, shipId: string): Promise<Map<string, CertificateFileRow[]>> {
    const map = new Map<string, CertificateFileRow[]>();
    for (const x of await this.rowsOf(orgSlug, shipId)) {
      const list = map.get(x.cert_key) ?? [];
      list.push(rowOf(x));
      map.set(x.cert_key, list);
    }
    return map;
  }

  async remove(viewer: SessionUser, shipId: string, fileId: string): Promise<void> {
    await this.ships.get(viewer, shipId);
    const schema = await this.tenantDb.schemaFor(viewer.orgSlug);
    const removed = await this.tenantDb.withOrg(viewer.orgSlug, async (client) => {
      const r = await client.query<{ cert_key: string; storage: 's3' | 'db'; storage_key: string | null }>(
        `UPDATE ship_certificate_file SET is_active = false, content = NULL
          WHERE id = $1 AND ship_id = $2 AND is_active
          RETURNING cert_key, storage, storage_key`,
        [fileId, shipId],
      );
      const x = r.rows[0];
      if (!x) throw new NotFoundException('No such file');
      await this.audit.content(
        { actorId: viewer.username, entityType: 'ship', entityId: shipId, data: { action: 'certificate_file_removed', certKey: x.cert_key, fileId }, schema },
        client,
      );
      return x;
    });
    await this.store.remove({ storage: removed.storage, storageKey: removed.storage_key });
  }
}
