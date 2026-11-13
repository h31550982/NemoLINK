/**
 * The ingest contract for admins (docs/specs/0052): the JSON Schema mirror
 * of the envelope, built at runtime so a deployed server can never serve a
 * stale copy. Static product metadata — no PII, no audit event.
 */

import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Authz } from '../auth/authz.decorator';
import {
  buildIngestEnvelopeJsonSchema,
  INGEST_SCHEMA_FILENAME,
  INGEST_SCHEMA_VERSION,
} from './envelope-json-schema';

@Controller('ingest/schema')
@Authz('session:admin')
export class IngestSchemaController {
  /** Session cookie rides along — a plain link downloads the schema. */
  @Get()
  download(@Res() res: Response): void {
    res.setHeader('Content-Type', 'application/schema+json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${INGEST_SCHEMA_FILENAME}"`,
    );
    res.send(JSON.stringify(buildIngestEnvelopeJsonSchema(), null, 2) + '\n');
  }

  @Get('meta')
  meta(): { version: string; filename: string } {
    return { version: INGEST_SCHEMA_VERSION, filename: INGEST_SCHEMA_FILENAME };
  }
}
