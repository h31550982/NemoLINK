import { Controller, Get, Module, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditModule } from '../audit/audit.module';
import { Authz } from '../auth/authz.decorator';
import type { SessionUser } from '../auth/session.service';
import { DbModule } from '../db/db.module';
import { NemoClientModule } from '../nemo-client/nemo-client.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { StatusService, type SystemStatus } from './status.service';

type AuthedRequest = Request & { user: SessionUser };

/** The header's status light (spec 0082): every signed-in user sees it. */
@Controller('status')
@Authz('session')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get()
  async get(@Req() req: AuthedRequest): Promise<SystemStatus> {
    // An unswitched platform admin has no organisation — no integrations line
    const org = req.user.platformAdmin && !req.user.acting ? null : req.user.orgSlug;
    return this.status.status(org);
  }
}

@Module({
  imports: [AuditModule, DbModule, NemoClientModule, TenancyModule],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService],
})
export class StatusModule {}

/** The worker's copy: the service without the HTTP controller. */
@Module({
  imports: [AuditModule, DbModule, NemoClientModule, TenancyModule],
  providers: [StatusService],
  exports: [StatusService],
})
export class StatusWorkerModule {}
