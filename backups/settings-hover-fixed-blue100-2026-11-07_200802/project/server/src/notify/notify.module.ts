import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailEventsController } from './email-events.controller';
import { EmailEventsService } from './email-events.service';
import { NotifyService } from './notify.service';

@Module({
  imports: [AuditModule],
  controllers: [EmailEventsController],
  providers: [EmailEventsService, NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
