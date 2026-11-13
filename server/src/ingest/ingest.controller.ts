/**
 * The one door in (docs/specs/0026): POST /api/v1/ingest with the standard
 * envelope, guarded by per-source scoped credentials ('ingest-key' policy —
 * the guard attaches request.ingest). 201 only when a port call was created;
 * every other accepted envelope answers 200 with its outcome.
 */

import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Authz } from '../auth/authz.decorator';
import { IngestContext } from './ingest-credential.service';
import { IngestResult, IngestService } from './ingest.service';

type IngestRequest = Request & { ingest: IngestContext };

@Controller('ingest')
@Authz('ingest-key')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: IngestRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ): Promise<IngestResult> {
    const result = await this.ingest.ingest(req.ingest, body);
    if (result.status === 'created') res.status(201);
    return result;
  }
}
