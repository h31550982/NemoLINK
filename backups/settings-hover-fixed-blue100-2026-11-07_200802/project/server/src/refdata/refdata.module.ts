import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DbModule } from '../db/db.module';
import { NemoClientModule } from '../nemo-client/nemo-client.module';
import { NotifyModule } from '../notify/notify.module';
import { RefdataController } from './refdata.controller';
import { RefdataSyncService } from './refdata-sync.service';

@Module({
  imports: [AuditModule, DbModule, NemoClientModule, NotifyModule],
  controllers: [RefdataController],
  providers: [RefdataSyncService],
  exports: [RefdataSyncService],
})
export class RefdataModule {}
