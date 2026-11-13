import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DbModule } from '../db/db.module';
import { NemoClientModule } from '../nemo-client/nemo-client.module';
import { NotifyModule } from '../notify/notify.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { VisitWatchService } from './visit-watch.service';

/** The hourly visit watch (docs/specs/0097) — the worker's. */
@Module({
  imports: [AuditModule, DbModule, NemoClientModule, NotifyModule, TenancyModule],
  providers: [VisitWatchService],
  exports: [VisitWatchService],
})
export class NemoWatchModule {}
