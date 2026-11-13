/**
 * Ingestion module (docs/specs/0026): the push door. Pull adapters (worker
 * pollers) join later and feed the same IngestService (invariant 11).
 */

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CanonicalModule } from '../canonical/canonical.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { IngestController } from './ingest.controller';
import { IngestCredentialModule } from './ingest-credential.module';
import { IngestSchemaController } from './ingest-schema.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [AuditModule, CanonicalModule, IngestCredentialModule, TenancyModule],
  controllers: [IngestController, IngestSchemaController, DocumentsController],
  providers: [IngestService, DocumentsService],
  // The NOA wizard reads the call's NEMO tables through it (spec 0098)
  exports: [DocumentsService],
})
export class IngestModule {}
