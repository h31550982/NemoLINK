/**
 * Certificate files of a ship (spec 0084): list, add (multipart "file",
 * optional "description"), download, remove. Admins of the org whose fleet
 * holds the ship; the copies are the org's own.
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
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Authz } from '../auth/authz.decorator';
import type { SessionUser } from '../auth/session.service';
import { CERT_FILE_MAX_BYTES, CertificateFilesService, type CertificateFileRow } from './certificate-files.service';

type AuthedRequest = Request & { user: SessionUser };

/** A certificate key: its type code, a colon, its number (possibly empty). */
const CERT_KEY_RE = /^[A-Z0-9_-]{1,16}:[^/\\]{0,64}$/;

function certKeyParam(raw: string): string {
  const key = decodeURIComponent(raw);
  if (!CERT_KEY_RE.test(key)) throw new BadRequestException('Not a certificate key');
  return key;
}

@Controller('ships/:id/certificate-files')
@Authz('session:admin')
export class CertificateFilesController {
  constructor(private readonly files: CertificateFilesService) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<{ files: CertificateFileRow[] }> {
    return { files: await this.files.list(req.user, id) };
  }

  @Post(':certKey')
  @HttpCode(201)
  // A little over NEMO's 10 MB so the service can say the limit in words
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CERT_FILE_MAX_BYTES + 1024, files: 1 } }))
  async upload(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('certKey') certKey: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { description?: unknown },
  ): Promise<{ file: CertificateFileRow }> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('Send the file as multipart field "file"');
    }
    const description = typeof body?.description === 'string' ? body.description : undefined;
    return { file: await this.files.upload(req.user, id, certKeyParam(certKey), file, description) };
  }

  @Get('file/:fileId')
  async download(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.files.file(req.user, id, fileId);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${f.fileName.replace(/["\\]/g, '')}"`);
    res.send(f.content);
  }

  @Post('file/:fileId/remove')
  @HttpCode(200)
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<{ ok: true }> {
    await this.files.remove(req.user, id, fileId);
    return { ok: true };
  }
}
