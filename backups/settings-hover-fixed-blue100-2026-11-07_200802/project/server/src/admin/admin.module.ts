import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CanonicalModule } from '../canonical/canonical.module';
import { DbModule } from '../db/db.module';
import { IngestModule } from '../ingest/ingest.module';
import { NemoClientModule } from '../nemo-client/nemo-client.module';
import { NotifyModule } from '../notify/notify.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import {
  AuditLogController,
  NemoSupportController,
  OrgController,
  PortCallNemoController,
  ShipsController,
} from './admin.controllers';
import { AuditLogService } from './audit-log.service';
import { OrgService } from './org.service';
import { CertificateFilesController } from './certificate-files.controller';
import { CertificateFilesService } from './certificate-files.service';
import { NemoSupportService } from './nemo-support.service';
import { FileStore } from '../files/file-store';
import { ShipNemoService } from './ship-nemo.service';
import { ShipsService } from './ships.service';

@Module({
  // CanonicalModule: the soft cancel the COA ends with (spec 0080)
  // IngestModule: the call's NEMO tables for the pre-arrival reports (spec 0098)
  imports: [AuditModule, CanonicalModule, DbModule, IngestModule, NemoClientModule, NotifyModule, TenancyModule],
  controllers: [
    ShipsController,
    AuditLogController,
    OrgController,
    PortCallNemoController,
    NemoSupportController,
    CertificateFilesController,
  ],
  providers: [AuditLogService, CertificateFilesService, FileStore, NemoSupportService, OrgService, ShipsService, ShipNemoService],
  // The platform page lists the master list through the same service (spec 0068)
  exports: [ShipsService],
})
export class AdminModule {}
