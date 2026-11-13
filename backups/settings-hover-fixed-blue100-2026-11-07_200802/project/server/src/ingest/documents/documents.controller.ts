/**
 * Port-call document routes (docs/specs/0049): drag-and-drop uploads of
 * the standard ship forms, their parsed summaries, the original bytes,
 * and soft removal. Session policy; role and captain-ship rules live in
 * the service.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Authz } from '../../auth/authz.decorator';
import { SessionUser } from '../../auth/session.service';
import {
  CodeOption,
  DOCUMENT_SECTIONS,
  DocumentSection,
  DocumentsService,
  PortCallDocumentRow,
} from './documents.service';
import type { MergedTable } from './form-tables';

const correctSchema = z
  .object({ path: z.string().min(1).max(200), value: z.string().max(200).nullable() })
  .strict();

const entrySchema = z
  .object({ rowKey: z.string().min(1).max(200), column: z.string().min(1).max(60), value: z.string().max(200).nullable() })
  .strict();

type AuthedRequest = Request & { user: SessionUser };

/** Biggest sample is 1.6 MB; scanned PDFs run bigger — plenty of room. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

@Controller('portcalls')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * One NEMO code list for the correction picker (spec 0093 §1): search by
   * code or words, or fetch named codes (the checker's suggestions). Only
   * the lists the form checks use.
   */
  @Get('codes/:list')
  @Authz('session')
  async codeOptions(
    @Param('list') list: string,
    @Query('q') q?: string,
    @Query('codes') codes?: string,
  ): Promise<{ options: CodeOption[] }> {
    return { options: await this.documents.codeOptions(list, q ?? '', codes ?? '') };
  }

  @Post(':id/documents')
  @Authz('session')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  async upload(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('section') section?: string,
  ): Promise<{ document: PortCallDocumentRow }> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('Send the file as multipart field "file"');
    }
    // Optional: the Ship forms section the file was dropped on (user 2026-11-02)
    if (section !== undefined && section !== '' && !(DOCUMENT_SECTIONS as readonly string[]).includes(section)) {
      throw new BadRequestException(`section must be one of ${DOCUMENT_SECTIONS.join(', ')}`);
    }
    const placed = section ? (section as DocumentSection) : null;
    return { document: await this.documents.upload(req.user, id, file, placed) };
  }

  /**
   * Several original files as one zip — a Ship forms section's "Download
   * all" (user 2026-11-02). Its own path, not under `:id/documents/…`,
   * where the `:docId` routes would claim it.
   */
  @Get(':id/original-files.zip')
  @Authz('session')
  async originalsZip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('ids') ids: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const list = (ids ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '');
    if (!list.every((x) => /^[0-9a-f-]{36}$/i.test(x))) throw new BadRequestException('ids must be document ids');
    const zip = await this.documents.originalsZip(req.user, id, list);
    res.setHeader('Content-Type', zip.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${zip.fileName}"`);
    res.send(zip.content);
  }

  @Get(':id/documents')
  @Authz('session')
  async list(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ documents: PortCallDocumentRow[] }> {
    return { documents: await this.documents.list(req.user, id) };
  }

  @Get(':id/documents/:docId')
  @Authz('session')
  async detail(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ): Promise<{ document: PortCallDocumentRow & { parsed: unknown } }> {
    return { document: await this.documents.detail(req.user, id, docId) };
  }

  @Get(':id/documents/:docId/file')
  @Authz('session')
  async file(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documents.file(req.user, id, docId);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${doc.fileName.replace(/["\\]/g, '')}"`,
    );
    res.send(doc.content);
  }

  /** The call's forms in NEMO's own tables (spec 0096). */
  @Get(':id/form-tables')
  @Authz('session')
  async formTables(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ tables: MergedTable[] }> {
    return { tables: await this.documents.formTables(req.user, id) };
  }

  /** The National Spreadsheet, prefilled from the NEMO tables (spec 0093 step 5). */
  @Get(':id/national-spreadsheet.xlsx')
  @Authz('session')
  async nationalSpreadsheet(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documents.nationalSpreadsheet(req.user, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/[^ -~]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.send(file.content);
  }

  /** Type a value into a NEMO table, or remove it (spec 0096). */
  @Post(':id/form-tables/:table/entry')
  @Authz('session')
  @HttpCode(200)
  async enterTableValue(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('table') table: string,
    @Body() body: unknown,
  ): Promise<{ tables: MergedTable[] }> {
    const parsed = entrySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Send { rowKey, column, value | null }');
    const { rowKey, column, value } = parsed.data;
    return { tables: await this.documents.enterTableValue(req.user, id, table, rowKey, column, value) };
  }

  /**
   * Several corrected files as one zip (spec 0093 §4). Its own path, not
   * under `:id/documents/…`, where the `:docId` routes would claim it.
   */
  @Get(':id/nemo-files.zip')
  @Authz('session')
  async correctedZip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('ids') ids: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const list = (ids ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '');
    if (!list.every((x) => /^[0-9a-f-]{36}$/i.test(x))) throw new BadRequestException('ids must be document ids');
    const zip = await this.documents.correctedZip(req.user, id, list);
    res.setHeader('Content-Type', zip.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${zip.fileName}"`);
    res.send(zip.content);
  }

  /** "Yes, this form is our ship's" — a form without an IMO starts counting (spec 0093 D4). */
  @Post(':id/documents/:docId/confirm-ship')
  @Authz('session')
  @HttpCode(200)
  async confirmShip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ): Promise<{ document: PortCallDocumentRow }> {
    return { document: await this.documents.confirmShip(req.user, id, docId) };
  }

  /** The file back in NEMO codes and units (spec 0093 §3). */
  @Get(':id/documents/:docId/corrected')
  @Authz('session')
  async corrected(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documents.corrected(req.user, id, docId);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${doc.fileName.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    );
    res.send(doc.content);
  }

  /** Correct one value in place — an audited operator overlay (spec 0051). */
  @Post(':id/documents/:docId/correct')
  @Authz('session')
  @HttpCode(200)
  async correct(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() body: unknown,
  ) {
    const parsed = correctSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Send { path, value } — value null removes the correction');
    }
    return this.documents.correct(req.user, id, docId, parsed.data.path, parsed.data.value);
  }

  @Post(':id/documents/:docId/remove')
  @Authz('session')
  @HttpCode(200)
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ): Promise<{ ok: true }> {
    await this.documents.remove(req.user, id, docId);
    return { ok: true };
  }
}
