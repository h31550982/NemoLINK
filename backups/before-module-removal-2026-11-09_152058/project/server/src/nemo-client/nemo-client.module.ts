import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CredentialCrypto } from './credential-crypto';
import { MigValidator } from './mig-validator';
import { NemoClientService } from './nemo-client.service';
import { NemoCredentialService } from './nemo-credential.service';

@Module({
  imports: [AuditModule, TenancyModule],
  providers: [MigValidator, NemoClientService, NemoCredentialService, CredentialCrypto],
  exports: [MigValidator, NemoClientService, NemoCredentialService, CredentialCrypto],
})
export class NemoClientModule {}
