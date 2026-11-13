/**
 * Module tree for the worker process (docs/specs/0021): no HTTP layer, no
 * controllers served — just the scheduled jobs and what they need. The outbox
 * submitter and status poller join here with their own specs (docs/02).
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { NemoWatchModule } from './nemo-watch/nemo-watch.module';
import { RefdataModule } from './refdata/refdata.module';
import { StatusWorkerModule } from './status/status.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    RefdataModule,
    // The hourly NEMO alive check (spec 0082)
    StatusWorkerModule,
    // The hourly visit watch: visits someone cancelled in NEMO (spec 0097)
    NemoWatchModule,
  ],
})
export class WorkerModule {}
