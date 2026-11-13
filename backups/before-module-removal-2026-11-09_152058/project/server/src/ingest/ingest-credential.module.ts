/**
 * Small standalone module so both the AuthzGuard (auth module) and the
 * ingest module can use credential resolution without a circular import
 * (docs/specs/0026).
 */

import { Module } from '@nestjs/common';
import { IngestCredentialService } from './ingest-credential.service';

@Module({
  providers: [IngestCredentialService],
  exports: [IngestCredentialService],
})
export class IngestCredentialModule {}
