/**
 * Canonical domain module (docs/specs/0026): the port-call spine. The
 * declaration/lane/resolution machinery (docs/03) joins here with the
 * Phase-2 declaration specs.
 */

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ManifestService } from './manifest.service';
import { PortCallService } from './port-call.service';
import { FleetController, PortCallsController } from './port-calls.controller';
import { ShipMasterService } from './ship-master.service';

@Module({
  imports: [AuditModule, TenancyModule],
  controllers: [FleetController, PortCallsController],
  providers: [PortCallService, ShipMasterService, ManifestService],
  exports: [PortCallService, ShipMasterService, ManifestService],
})
export class CanonicalModule {}
