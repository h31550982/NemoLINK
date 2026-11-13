/**
 * Port-call documents (docs/specs/0049): the ingest staging store made
 * real. Uploaded ship forms are kept raw and immutable in the tenant
 * schema, classified and parsed on arrival. Nothing here ever writes the
 * port-call spine — parsed documents are raw material for the Phase-2
 * declaration lanes. Captains reach only their own ship's calls (404, no
 * oracle). Upload/remove emit same-tx org-chain content events without
 * parsed rows (append-only chains must not hold PII); parsed-detail and
 * file reads emit access events (invariant 5). No parsed content in logs
 * (invariant 3).
 */

import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ConflictException,
  NotFoundException,
  OnApplicationBootstrap,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../audit/audit.service';
import { SessionUser } from '../../auth/session.service';
import { TenantDb } from '../../tenancy/tenant-db';
import { LISTS, TABLE_LISTS, loadCodeBook, rememberPick } from './form-codes';
import { MergedTable, SourceDoc, TableEntry, TableKey, buildTables, columnOf, entryValue } from './form-tables';
import { nationalSpreadsheet, warmNationalSpreadsheet } from './national-spreadsheet';
import { CorrectedFile, XLSX_TYPE, correctedFile, zipFiles } from './corrected-file';
import {
  CORRECTION_PATH_RE,
  CallShip,
  Corrections,
  DocumentChecks,
  applyCorrections,
  pathExists,
  runChecks,
  shipImoMismatch,
  valueAt,
} from './form-checks';
import { refreshFormFacts } from '../../canonical/form-facts';
import { ParseResult, ParsedForm, parseForm, summarize } from './form-parser';
import { FileKind, sniffKind } from './workbook';
import { sniffCertificateType } from '../../admin/certificate-files.service';

/** Same escaping as the audit search (spec 0019): % _ \ become literals. */
function likePattern(q: string): string {
  return '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
}

/** One entry of a NEMO code list, for the correction picker. */
export interface CodeOption {
  code: string;
  label: string;
}

export interface PortCallDocumentRow {
  id: string;
  portCallId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  formType: string | null;
  context: string | null;
  parseStatus: 'parsed' | 'pdf' | 'unrecognized' | 'failed';
  parseNote: string | null;
  summary: Record<string, unknown> | null;
  uploadedBy: string;
  created: string;
  /** The file names no IMO: it counts for the call once confirmed (spec 0093 D4). */
  shipConfirmNeeded: boolean;
  /** The Ship forms section it was dropped on (user 2026-11-02), or null. */
  section: string | null;
  /** Upload only: these bytes were already on the call. */
  duplicate?: boolean;
  /** Upload only: earlier versions of the same form this one replaced. */
  supersededIds?: string[];
}

const PDF_NOTE =
  'Data can’t be read from a PDF — the file is stored, but please upload ' +
  'the Excel version of the form for the contents to be read.';
const UNRECOGNIZED_NOTE =
  'Not a recognized NSW or IMO FAL form — the file is stored, but no data was read.';
const FAILED_NOTE = 'The file could not be opened as a spreadsheet.';
const ATTACHMENT_NOTE = 'Kept on the call as it is — XML files and pictures are not read.';

const ROW_SQL = `id, port_call_id, file_name, content_type, byte_size, sha256,
                 form_type, context, parse_status, parse_note, summary,
                 uploaded_by, created, ship_confirm_needed, section`;

interface DbRow {
  id: string;
  port_call_id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  form_type: string | null;
  context: string | null;
  parse_status: PortCallDocumentRow['parseStatus'];
  parse_note: string | null;
  summary: Record<string, unknown> | null;
  uploaded_by: string;
  created: Date;
  ship_confirm_needed: boolean;
  section: string | null;
}

function toRow(r: DbRow): PortCallDocumentRow {
  return {
    id: r.id,
    portCallId: r.port_call_id,
    fileName: r.file_name,
    contentType: r.content_type,
    byteSize: r.byte_size,
    sha256: r.sha256,
    formType: r.form_type,
    context: r.context,
    parseStatus: r.parse_status,
    parseNote: r.parse_note,
    summary: r.summary,
    uploadedBy: r.uploaded_by,
    created: r.created.toISOString(),
    shipConfirmNeeded: r.ship_confirm_needed,
    section: r.section,
  };
}

/** The Ship forms sections a file can be dropped on — the form tables' keys. */
export const DOCUMENT_SECTIONS = ['crew', 'passengers', 'stores', 'waste', 'security', 'health'] as const;
export type DocumentSection = (typeof DOCUMENT_SECTIONS)[number];

const MIME_BY_KIND: Record<Exclude<FileKind, 'unknown'>, string> = {
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Path parts stripped, length clamped — the name is display data only. */
function safeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').trim();
  return (base === '' ? 'upload' : base).slice(0, 200);
}

@Injectable()
export class DocumentsService implements OnApplicationBootstrap {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /** NEMO's workbook read and slimmed once, off the first download's clock. */
  onApplicationBootstrap(): void {
    setImmediate(warmNationalSpreadsheet);
  }

  private assertReadRole(user: SessionUser): void {
    if (!['admin', 'editor', 'viewer', 'captain'].includes(user.role)) {
      throw new ForbiddenException();
    }
  }

  private assertUploadRole(user: SessionUser): void {
    if (!['admin', 'editor', 'captain'].includes(user.role)) {
      throw new ForbiddenException();
    }
  }

  /**
   * The call must exist, be active, and — for captains — belong to their
   * ship. A foreign call answers 404 either way (no oracle). Returns the
   * call's ship for the identity checks (spec 0050).
   */
  private async assertCallAccess(
    client: PoolClient,
    user: SessionUser,
    portCallId: string,
  ): Promise<CallShip> {
    const result = await client.query(
      `SELECT pc.ship_id, s.name AS ship_name, s.imo_number
         FROM port_call pc
         LEFT JOIN platform.ship s ON s.id = pc.ship_id
        WHERE pc.id = $1 AND pc.is_active`,
      [portCallId],
    );
    const call = result.rows[0] as
      | { ship_id: string | null; ship_name: string | null; imo_number: string | null }
      | undefined;
    if (!call) throw new NotFoundException();
    if (user.role === 'captain') {
      if (!user.shipId || call.ship_id !== user.shipId) {
        throw new NotFoundException();
      }
    }
    return { name: call.ship_name, imoNumber: call.imo_number };
  }

  async upload(
    user: SessionUser,
    portCallId: string,
    file: { originalname: string; buffer: Buffer; size: number },
    section: DocumentSection | null = null,
  ): Promise<PortCallDocumentRow> {
    this.assertUploadRole(user);
    const kind = sniffKind(file.buffer);
    // A Ship forms section also takes the types NEMO accepts as attachments
    // (XML, JPG, PNG — user 2026-11-02): kept as they are, never read
    const attachment = kind === 'unknown' && section ? sniffCertificateType(file.buffer) : null;
    if (kind === 'unknown' && !attachment) {
      throw new BadRequestException(
        section
          ? 'Only PDF, Excel (.xls, .xlsx), XML, JPG and PNG files are accepted.'
          : 'Only the Excel forms (.xls, .xlsx) and PDF files are accepted.',
      );
    }
    const contentType = attachment
      ? attachment.contentType
      : MIME_BY_KIND[kind as Exclude<FileKind, 'unknown'>];

    let parseStatus: PortCallDocumentRow['parseStatus'];
    let parseNote: string | null = null;
    let result: ParseResult | null = null;
    if (attachment) {
      parseStatus = 'unrecognized';
      parseNote = ATTACHMENT_NOTE;
    } else if (kind === 'pdf') {
      parseStatus = 'pdf';
      parseNote = PDF_NOTE;
    } else {
      try {
        result = parseForm(file.buffer);
        parseStatus = result.form ? 'parsed' : 'unrecognized';
        if (!result.form) parseNote = UNRECOGNIZED_NOTE;
      } catch {
        // Never log the content — the raw file is kept for a human look
        parseStatus = 'failed';
        parseNote = FAILED_NOTE;
      }
    }
    const form = result?.form ?? null;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fileName = safeFileName(file.originalname);

    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const callShip = await this.assertCallAccess(client, user, portCallId);

      // HARD GATE (spec 0050 amendment): ship 1's data is never accepted
      // for ship 2 — refused before dedupe/supersede, nothing stored,
      // nothing audited (rejected input is never durably kept, spec 0008)
      const mismatch = form ? shipImoMismatch(form, callShip) : null;
      if (mismatch) {
        throw new UnprocessableEntityException(
          `IMO number in the file (${mismatch.fileImo}) is not this ship’s ` +
            `IMO (${mismatch.shipImo}) — this file belongs to another ship, ` +
            'so nothing was saved. Check which call you dropped it on.',
        );
      }

      const existing = await client.query(
        `SELECT ${ROW_SQL} FROM port_call_document
          WHERE port_call_id = $1 AND sha256 = $2 AND is_active`,
        [portCallId, sha256],
      );
      if (existing.rows[0]) {
        // Same bytes already on the call — nothing written, nothing audited
        return { ...toRow(existing.rows[0] as DbRow), duplicate: true };
      }

      // Reference + identity checks (spec 0050) — stored with the
      // document; the detail read recomputes them fresh
      const checks = form ? await runChecks(client, form, callShip) : null;
      const summary = form
        ? {
            ...summarize(form),
            ...(checks && (checks.errorCount || checks.warningCount)
              ? { errorCount: checks.errorCount, warningCount: checks.warningCount }
              : {}),
          }
        : null;
      const parsed = result
        ? { form, grid: result.grid, gridTruncated: result.gridTruncated, checks }
        : null;

      // Last in wins (spec 0050): a parsed form supersedes the active
      // document of the same type and context. The stale content is
      // DISCARDED (user decision — a replaced crew list is PII with no
      // reason to linger); the metadata row and audit events remain the
      // record of what happened.
      let superseded: { id: string; file_name: string }[] = [];
      if (form) {
        const old = await client.query(
          `UPDATE port_call_document
              SET is_active = false, content = ''::bytea, parsed = NULL
            WHERE port_call_id = $1 AND form_type = $2
              AND context IS NOT DISTINCT FROM $3 AND is_active
            RETURNING id, file_name`,
          [portCallId, form.formType, form.context],
        );
        superseded = old.rows as { id: string; file_name: string }[];
      }

      const inserted = await client.query(
        `INSERT INTO port_call_document
           (port_call_id, file_name, content_type, byte_size, sha256, content,
            form_type, context, parse_status, parse_note, parsed, summary,
            uploaded_by, ship_confirm_needed, section)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15)
         RETURNING ${ROW_SQL}`,
        [
          portCallId,
          fileName,
          contentType,
          file.size,
          sha256,
          file.buffer,
          form?.formType ?? null,
          form?.context ?? null,
          parseStatus,
          parseNote,
          parsed === null ? null : JSON.stringify(parsed),
          summary === null ? null : JSON.stringify(summary),
          user.username,
          // D4 (spec 0093): a form that names no IMO counts once confirmed
          !!form && !form.fields['imo'] && !!callShip.imoNumber,
          section,
        ],
      );
      const row = toRow(inserted.rows[0] as DbRow);
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call_document',
          entityId: row.id,
          data: {
            action: 'uploaded',
            portCallId,
            fileName,
            sha256,
            byteSize: file.size,
            formType: row.formType,
            parseStatus,
            ...(section ? { section } : {}),
            // list-safe summary only — parsed rows are PII and stay out
            // of the append-only chain
            ...(summary ? { summary } : {}),
            ...(superseded.length > 0
              ? {
                  superseded: superseded.map((s) => ({
                    id: s.id,
                    fileName: s.file_name,
                  })),
                }
              : {}),
          },
          schema,
        },
        client,
      );
      // The notices read the forms' facts from the call (spec 0090)
      if (form) await refreshFormFacts(client, portCallId);
      return superseded.length > 0
        ? { ...row, supersededIds: superseded.map((s) => s.id) }
        : row;
    });
  }

  async list(user: SessionUser, portCallId: string): Promise<PortCallDocumentRow[]> {
    this.assertReadRole(user);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      await this.assertCallAccess(client, user, portCallId);
      const result = await client.query(
        `SELECT ${ROW_SQL} FROM port_call_document
          WHERE port_call_id = $1 AND is_active
          ORDER BY created DESC`,
        [portCallId],
      );
      return (result.rows as DbRow[]).map(toRow);
    });
  }

  /**
   * Full parsed content — a PII read, audited as access (invariant 5).
   * The checks come back recomputed against the CURRENT master list
   * (spec 0050): a refdata sync that adds a port heals old flags; the
   * copy stored at upload stays in `parsed.checks` as history.
   */
  async detail(
    user: SessionUser,
    portCallId: string,
    documentId: string,
  ): Promise<
    PortCallDocumentRow & {
      parsed: unknown;
      checks: DocumentChecks | null;
      corrections: Corrections | null;
    }
  > {
    this.assertReadRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const { row, checks } = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const callShip = await this.assertCallAccess(client, user, portCallId);
      const result = await client.query(
        `SELECT ${ROW_SQL}, parsed, corrections FROM port_call_document
          WHERE id = $1 AND port_call_id = $2 AND is_active`,
        [documentId, portCallId],
      );
      if (!result.rows[0]) throw new NotFoundException();
      const found = result.rows[0] as DbRow & {
        parsed: { form?: ParsedForm | null } | null;
        corrections: Corrections | null;
      };
      // Checks run on the EFFECTIVE view — parsed with the operator's
      // corrections laid over (spec 0051)
      const fresh = found.parsed?.form
        ? await runChecks(
            client,
            applyCorrections(found.parsed.form, found.corrections),
            callShip,
          )
        : null;
      return { row: found, checks: fresh };
    });
    await this.audit.access({
      actorId: user.username,
      entityType: 'port_call_document',
      entityId: documentId,
      data: { action: 'parsed_read', portCallId, fileName: row.file_name },
      schema,
    });
    return { ...toRow(row), parsed: row.parsed, checks, corrections: row.corrections };
  }

  /** The original bytes — audited as access, like any export. */
  async file(
    user: SessionUser,
    portCallId: string,
    documentId: string,
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    this.assertReadRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const row = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      await this.assertCallAccess(client, user, portCallId);
      const result = await client.query(
        `SELECT file_name, content_type, content FROM port_call_document
          WHERE id = $1 AND port_call_id = $2 AND is_active`,
        [documentId, portCallId],
      );
      if (!result.rows[0]) throw new NotFoundException();
      return result.rows[0] as { file_name: string; content_type: string; content: Buffer };
    });
    await this.audit.access({
      actorId: user.username,
      entityType: 'port_call_document',
      entityId: documentId,
      data: { action: 'file_download', portCallId, fileName: row.file_name },
      schema,
    });
    return {
      fileName: row.file_name,
      contentType: row.content_type,
      content: row.content,
    };
  }

  /**
   * Several original files as one zip — "Download all files from this
   * section" in Ship forms (user 2026-11-02). Only this call's active
   * documents; any other id is refused, naming nothing.
   */
  async originalsZip(
    user: SessionUser,
    portCallId: string,
    documentIds: string[],
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    this.assertReadRole(user);
    if (documentIds.length === 0) throw new BadRequestException('Name at least one document');
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const rows = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      await this.assertCallAccess(client, user, portCallId);
      const result = await client.query(
        `SELECT id, file_name, content FROM port_call_document
          WHERE port_call_id = $1 AND id = ANY($2::uuid[]) AND is_active`,
        [portCallId, documentIds],
      );
      if (result.rows.length !== new Set(documentIds).size) throw new NotFoundException();
      return result.rows as { id: string; file_name: string; content: Buffer }[];
    });
    for (const r of rows) {
      await this.audit.access({
        actorId: user.username,
        entityType: 'port_call_document',
        entityId: r.id,
        data: { action: 'file_download', portCallId, fileName: r.file_name, zip: true },
        schema,
      });
    }
    return {
      fileName: 'Section files.zip',
      contentType: 'application/zip',
      content: zipFiles(rows.map((r) => ({ fileName: r.file_name, content: r.content }))),
    };
  }

  /**
   * Correct one value in place (spec 0051): an operator overlay keyed by
   * check path — parsed stays the file's own words (invariant 9), the
   * audit event is the history, and the checks + stored summary counts
   * refresh in the same transaction so flags heal immediately.
   * `value: null` removes the correction.
   */
  /**
   * The ship's file back, corrected to NEMO codes and units (spec 0093 §3):
   * the same workbook with only the checked and corrected cells rewritten;
   * `.xls` comes back as `.xlsx` (D3). Refused (409) while any value is
   * still in error. Audited as access, like the original.
   */
  async corrected(
    user: SessionUser,
    portCallId: string,
    documentId: string,
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    this.assertReadRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const made = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const callShip = await this.assertCallAccess(client, user, portCallId);
      return this.makeCorrected(client, callShip, portCallId, documentId);
    });
    if (!made.result.ok) throw new ConflictException(made.result.problem);
    await this.audit.access({
      actorId: user.username,
      entityType: 'port_call_document',
      entityId: documentId,
      data: { action: 'corrected_download', portCallId, fileName: made.fileName },
      schema,
    });
    return { fileName: made.result.fileName, contentType: XLSX_TYPE, content: made.result.content };
  }

  /**
   * Several corrected files in one zip — the forms wizard's last step
   * (spec 0093 §4). All or nothing: any file that cannot be made yet
   * refuses the zip, naming it.
   */
  async correctedZip(
    user: SessionUser,
    portCallId: string,
    documentIds: string[],
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    this.assertReadRole(user);
    if (documentIds.length === 0 || documentIds.length > 30) {
      throw new BadRequestException('Name between 1 and 30 documents');
    }
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const made = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const callShip = await this.assertCallAccess(client, user, portCallId);
      const out: { id: string; fileName: string; result: CorrectedFile }[] = [];
      for (const id of documentIds) {
        out.push({ id, ...(await this.makeCorrected(client, callShip, portCallId, id)) });
      }
      return out;
    });
    const refused = made.filter((m) => !m.result.ok);
    if (refused.length > 0) {
      throw new ConflictException(
        refused.map((m) => `${m.fileName}: ${(m.result as { problem: string }).problem}`).join(' · '),
      );
    }
    for (const m of made) {
      await this.audit.access({
        actorId: user.username,
        entityType: 'port_call_document',
        entityId: m.id,
        data: { action: 'corrected_download', portCallId, fileName: m.fileName, zip: true },
        schema,
      });
    }
    return {
      fileName: 'Ship forms (NEMO).zip',
      contentType: 'application/zip',
      content: zipFiles(made.map((m) => m.result as { fileName: string; content: Buffer })),
    };
  }

  /** One corrected file, inside the caller's tenant transaction. */
  private async makeCorrected(
    client: PoolClient,
    callShip: CallShip,
    portCallId: string,
    documentId: string,
  ): Promise<{ fileName: string; result: CorrectedFile }> {
    const found = await client.query(
      `SELECT file_name, content, parsed, corrections FROM port_call_document
        WHERE id = $1 AND port_call_id = $2 AND is_active`,
      [documentId, portCallId],
    );
    const row = found.rows[0] as
      | { file_name: string; content: Buffer; parsed: { form?: ParsedForm | null } | null; corrections: Corrections | null }
      | undefined;
    if (!row) throw new NotFoundException();
    let form = row.parsed?.form;
    if (!form) throw new ConflictException('Only a recognised ship form can be given back corrected');
    if (!form.cells) {
      // Parsed before spec 0093: the stored bytes give the cell map
      const again = parseForm(row.content).form;
      if (!again || again.formType !== form.formType) {
        throw new ConflictException('This file can no longer be read — upload it again');
      }
      form = { ...form, cells: again.cells, sheet: again.sheet };
    }
    const effective = applyCorrections(form, row.corrections);
    const checks = await runChecks(client, effective, callShip);
    return { fileName: row.file_name, result: correctedFile(row.content, row.file_name, form, effective, checks, row.corrections) };
  }

  /**
   * "Yes, this is our ship's" (spec 0093 D4): a form that names no IMO
   * starts counting for the call. Upload roles only; audited as content.
   */
  async confirmShip(user: SessionUser, portCallId: string, documentId: string): Promise<PortCallDocumentRow> {
    this.assertUploadRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      await this.assertCallAccess(client, user, portCallId);
      const updated = await client.query(
        `UPDATE port_call_document
            SET ship_confirm_needed = false, ship_confirmed_by = $3, ship_confirmed_at = now()
          WHERE id = $1 AND port_call_id = $2 AND is_active
          RETURNING ${ROW_SQL}`,
        [documentId, portCallId, user.username],
      );
      if (!updated.rows[0]) throw new NotFoundException();
      const row = toRow(updated.rows[0] as DbRow);
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call_document',
          entityId: documentId,
          data: { action: 'ship_confirmed', portCallId, fileName: row.fileName },
          schema,
        },
        client,
      );
      await refreshFormFacts(client, portCallId);
      return row;
    });
  }

  async correct(
    user: SessionUser,
    portCallId: string,
    documentId: string,
    path: string,
    value: string | null,
  ): Promise<{
    document: PortCallDocumentRow;
    corrections: Corrections;
    checks: DocumentChecks;
  }> {
    this.assertUploadRole(user);
    if (!CORRECTION_PATH_RE.test(path)) {
      throw new BadRequestException('Not a correctable value');
    }
    const newValue = value === null ? null : value.trim().slice(0, 200);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const callShip = await this.assertCallAccess(client, user, portCallId);
      const found = await client.query(
        `SELECT ${ROW_SQL}, parsed, corrections FROM port_call_document
          WHERE id = $1 AND port_call_id = $2 AND is_active
          FOR UPDATE`,
        [documentId, portCallId],
      );
      if (!found.rows[0]) throw new NotFoundException();
      const row = found.rows[0] as DbRow & {
        parsed: { form?: ParsedForm | null } | null;
        corrections: Corrections | null;
      };
      const form = row.parsed?.form;
      if (!form) {
        throw new BadRequestException('Only parsed documents can be corrected');
      }
      if (!pathExists(form, path)) {
        throw new BadRequestException('No such value in this document');
      }
      const current: Corrections = row.corrections ?? {};
      const before = valueAt(applyCorrections(form, current), path) ?? '';

      const next: Corrections = { ...current };
      if (newValue === null) {
        delete next[path];
      } else {
        next[path] = {
          value: newValue,
          author: user.username,
          at: new Date().toISOString(),
        };
      }
      const effective = applyCorrections(form, next);
      const after = valueAt(effective, path) ?? '';
      const checks = await runChecks(client, effective, callShip);
      if (before === after && (newValue !== null || current[path] === undefined)) {
        // Nothing changes — no write, no audit noise
        return { document: toRow(row), corrections: current, checks };
      }
      const summary = {
        ...summarize(effective),
        ...(checks.errorCount || checks.warningCount
          ? { errorCount: checks.errorCount, warningCount: checks.warningCount }
          : {}),
      };
      const updated = await client.query(
        `UPDATE port_call_document
            SET corrections = $3::jsonb, summary = $4::jsonb
          WHERE id = $1 AND port_call_id = $2 AND is_active
          RETURNING ${ROW_SQL}`,
        [
          documentId,
          portCallId,
          Object.keys(next).length > 0 ? JSON.stringify(next) : null,
          JSON.stringify(summary),
        ],
      );
      // Person rows (crew/passenger/effects lists) are PII — the
      // append-only chain records THAT the value changed, not what it was
      const personRows =
        ['nsw-crew', 'nsw-pax', 'fal4', 'fal5', 'fal6'].includes(form.formType) &&
        path.startsWith('rows.');
      const redact = personRows || path === 'fields.master';
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call_document',
          entityId: documentId,
          data: {
            action: newValue === null ? 'correction_removed' : 'corrected',
            portCallId,
            fileName: row.file_name,
            path,
            from: redact ? '[personal data]' : before,
            to: redact ? '[personal data]' : after,
          },
          schema,
        },
        client,
      );
      if (newValue !== null) {
        // The file's own words → the picked code, remembered for the org
        await rememberPick(client, valueAt(form, path), checks.annotations[path], user.username);
      }
      await refreshFormFacts(client, portCallId);
      return { document: toRow(updated.rows[0] as DbRow), corrections: next, checks };
    });
  }

  /**
   * The call's forms merged into NEMO's own tables (spec 0096): every NEMO
   * column, each cell with its source, reading and flag. Forms waiting for
   * their ship to be confirmed (0093 D4) do not feed them. A PII read,
   * audited as access like the document detail.
   */
  async formTables(user: SessionUser, portCallId: string): Promise<MergedTable[]> {
    this.assertReadRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const tables = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const callShip = await this.assertCallAccess(client, user, portCallId);
      const found = await client.query(
        `SELECT id, file_name, created, parsed, corrections FROM port_call_document
          WHERE port_call_id = $1 AND is_active AND parsed IS NOT NULL
            AND NOT ship_confirm_needed
          ORDER BY created`,
        [portCallId],
      );
      const docs: SourceDoc[] = [];
      for (const row of found.rows as {
        id: string;
        file_name: string;
        created: Date;
        parsed: { form?: ParsedForm | null } | null;
        corrections: Corrections | null;
      }[]) {
        const form = row.parsed?.form;
        if (!form) continue;
        const effective = applyCorrections(form, row.corrections);
        const checks = await runChecks(client, effective, callShip);
        docs.push({ id: row.id, fileName: row.file_name, created: row.created.toISOString(), form: effective, annotations: checks.annotations });
      }
      return buildTables(docs, await loadCodeBook(client, TABLE_LISTS), await this.entriesOf(client, portCallId));
    });
    await this.audit.access({
      actorId: user.username,
      entityType: 'port_call',
      entityId: portCallId,
      data: { action: 'form_tables_read', tables: tables.map((t) => t.key) },
      schema,
    });
    return tables;
  }

  /**
   * The National Spreadsheet, prefilled from the call's NEMO tables (0093
   * step 5): the backup when the NEMO API is down — every user may take it.
   * Audited as access (it carries the crew list).
   */
  async nationalSpreadsheet(
    user: SessionUser,
    portCallId: string,
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    const tables = await this.formTables(user, portCallId);
    const name = await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const found = await client.query(
        `SELECT s.name AS ship, p.port_locode AS port, p.eta
           FROM port_call p LEFT JOIN platform.ship s ON s.id = p.ship_id
          WHERE p.id = $1`,
        [portCallId],
      );
      const r = found.rows[0] as { ship: string | null; port: string | null; eta: Date | null } | undefined;
      const day = r?.eta ? r.eta.toISOString().slice(0, 10) : '';
      return [r?.ship, r?.port, day].filter(Boolean).join(' ') || 'Port call';
    });
    return {
      fileName: `${name.replace(/["\\/:*?<>|]/g, '')} NationalSpreadsheet.xlsx`,
      contentType: XLSX_TYPE,
      content: nationalSpreadsheet(tables),
    };
  }

  private async entriesOf(client: PoolClient, portCallId: string): Promise<TableEntry[]> {
    const found = await client.query(
      `SELECT table_key, row_key, column_key, value, author, updated FROM call_form_entry
        WHERE port_call_id = $1`,
      [portCallId],
    );
    return (found.rows as { table_key: TableKey; row_key: string; column_key: string; value: string; author: string; updated: Date }[]).map((r) => ({
      table: r.table_key,
      rowKey: r.row_key,
      column: r.column_key,
      value: r.value,
      author: r.author,
      at: r.updated.toISOString(),
    }));
  }

  /**
   * Type a value into a NEMO table (spec 0096 decision 2) — or with null,
   * remove it and fall back to the forms. Upload roles; the value must be
   * one NEMO can take. Audited as content; personal columns redacted.
   */
  async enterTableValue(
    user: SessionUser,
    portCallId: string,
    table: string,
    rowKey: string,
    column: string,
    value: string | null,
  ): Promise<MergedTable[]> {
    this.assertUploadRole(user);
    const def = columnOf(table as TableKey, column);
    if (!def) throw new BadRequestException('No such table column');
    if (!/^[\p{L}\p{N}|_ .'-]{1,200}$/u.test(rowKey)) throw new BadRequestException('Not a row of this table');
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      await this.assertCallAccess(client, user, portCallId);
      let stored: string | null = null;
      if (value !== null) {
        const read = entryValue(def, value, await loadCodeBook(client, TABLE_LISTS));
        if ('problem' in read) throw new BadRequestException(`${def.label}: ${read.problem}`);
        stored = read.value;
        await client.query(
          `INSERT INTO call_form_entry (port_call_id, table_key, row_key, column_key, value, author)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (port_call_id, table_key, row_key, column_key)
           DO UPDATE SET value = EXCLUDED.value, author = EXCLUDED.author, updated = now()`,
          [portCallId, table, rowKey, column, stored, user.username],
        );
      } else {
        await client.query(
          `DELETE FROM call_form_entry
            WHERE port_call_id = $1 AND table_key = $2 AND row_key = $3 AND column_key = $4`,
          [portCallId, table, rowKey, column],
        );
      }
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: {
            action: value === null ? 'table_entry_removed' : 'table_entry',
            table,
            column,
            row: def.personal ? '[personal data]' : rowKey,
            value: value === null ? null : def.personal ? '[personal data]' : stored,
          },
          schema,
        },
        client,
      );
    });
    return this.formTables(user, portCallId);
  }

  /** Code list options for the correction picker (spec 0093 §1). */
  async codeOptions(list: string, q: string, codes: string): Promise<CodeOption[]> {
    if (!TABLE_LISTS.includes(list)) {
      throw new BadRequestException('Not a form code list');
    }
    const wanted = codes.split(',').map((c) => c.trim()).filter((c) => c !== '').slice(0, 20);
    const words = q.trim().slice(0, 60);
    return this.tenantDb.platform(async (client) => {
      const res = await client.query(
        `SELECT DISTINCT ON (code) code, en FROM platform.codelist_entry
          WHERE codelist = $1 AND is_active
            AND (cardinality($2::text[]) = 0 OR code = ANY($2))
            AND ($3 = '' OR code ILIKE $4 OR en ILIKE $4 OR fi ILIKE $4 OR sv ILIKE $4)
          ORDER BY code LIMIT 60`,
        [list, wanted, words, likePattern(words)],
      );
      return (res.rows as { code: string; en: string | null }[]).map((r) => ({
        code: r.code,
        label: (r.en ?? r.code).replace(/&#x27;/g, '’'),
      }));
    });
  }

  /** Soft delete — operators, or the captain taking back their own upload. */
  async remove(user: SessionUser, portCallId: string, documentId: string): Promise<void> {
    this.assertUploadRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      await this.assertCallAccess(client, user, portCallId);
      const isOperator = ['admin', 'editor'].includes(user.role);
      const result = await client.query(
        `UPDATE port_call_document
            SET is_active = false
          WHERE id = $1 AND port_call_id = $2 AND is_active
            AND ($3 OR uploaded_by = $4)
          RETURNING file_name, sha256`,
        [documentId, portCallId, isOperator, user.username],
      );
      const row = result.rows[0] as { file_name: string; sha256: string } | undefined;
      if (!row) throw new NotFoundException();
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call_document',
          entityId: documentId,
          data: {
            action: 'removed',
            portCallId,
            fileName: row.file_name,
            sha256: row.sha256,
          },
          schema,
        },
        client,
      );
      await refreshFormFacts(client, portCallId);
    });
  }
}
