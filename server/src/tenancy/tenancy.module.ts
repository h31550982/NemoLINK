import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProvisioningService } from './provisioning.service';
import { TenantDb } from './tenant-db';

@Module({
  imports: [AuditModule],
  providers: [ProvisioningService, TenantDb],
  exports: [ProvisioningService, TenantDb],
})
export class TenancyModule {}
