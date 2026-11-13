import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CanonicalModule } from './canonical/canonical.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { IngestModule } from './ingest/ingest.module';
import { NemoClientModule } from './nemo-client/nemo-client.module';
import { NotifyModule } from './notify/notify.module';
import { PlatformModule } from './platform/platform.module';
import { RefdataModule } from './refdata/refdata.module';
import { StatusModule } from './status/status.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AdminModule,
    AuthModule,
    CanonicalModule,
    DbModule,
    HealthModule,
    IngestModule,
    NemoClientModule,
    NotifyModule,
    PlatformModule,
    RefdataModule,
    StatusModule,
    TenancyModule,
  ],
})
export class AppModule {}
