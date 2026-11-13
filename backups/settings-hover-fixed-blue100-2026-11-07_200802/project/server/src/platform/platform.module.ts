/**
 * Platform-admin module (docs/specs/0030). Imports AuthModule for
 * SessionService (acting-org lives on the session) — AuthModule must never
 * import this module back.
 */

import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RefdataModule } from '../refdata/refdata.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AdminModule, AuditModule, AuthModule, RefdataModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
