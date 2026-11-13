/**
 * nemolink-worker entrypoint (docs/specs/0021): a Nest application context
  * (no HTTP server) that runs the refdata sync cycle on boot, then the
 * reference lists weekly, Monday 12:00 Finnish time, and the ship master list
 * daily at 05:00 UTC (spec 0068). Unavailable jobs (e.g. location service URL not
 * configured yet) are skipped quietly; a job already running elsewhere is skipped too — the
 * advisory lock in RefdataSyncService makes double-running impossible.
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { runMigrationsOnBoot } from './db/migrations';
import { RefdataSyncService, SYNC_JOBS, SyncJob } from './refdata/refdata-sync.service';
import { nextDailyShipsSlot, nextWeeklySlot } from './refdata/sync-schedule';
import { VisitWatchService } from './nemo-watch/visit-watch.service';
import { StatusService } from './status/status.service';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // The worker starts in parallel with the server, so it must not run against
  // an old schema either. The advisory lock means whichever container arrives
  // first applies and the other replays a no-op (spec 0058).
  await runMigrationsOnBoot();

  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('worker');
  const refdata = app.get(RefdataSyncService);
  const config = app.get(ConfigService);

  const cycle = async (jobs: readonly SyncJob[]): Promise<void> => {
    for (const job of jobs) {
      const avail = refdata.availability(job);
      if (!avail.available) {
        logger.log(`${job}: skipped — ${avail.reason}`);
        continue;
      }
      try {
        const run = await refdata.run(job, 'worker');
        logger.log(`${job}: ${run.status} ${JSON.stringify(run.stats)}${run.error ? ` — ${run.error}` : ''}`);
      } catch (error) {
        // Covers "already running" (another process holds the lock) and
        // bookkeeping failures; the run row carries sync errors themselves.
        logger.warn(`${job}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  // Each schedule re-arms itself after its run; the advisory lock keeps the
  // two from ever running the same job at once
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (name: string, jobs: readonly SyncJob[], next: (now: Date) => Date): void => {
    const at = next(new Date());
    logger.log(`${name} next at ${at.toISOString()}`);
    timers.set(
      name,
      setTimeout(
        () => void cycle(jobs).finally(() => schedule(name, jobs, next)),
        at.getTime() - Date.now(),
      ),
    );
  };

  // Is NEMO alive? One light authenticated read, hourly, recorded (spec 0082)
  const status = app.get(StatusService);
  const aliveMinutes = Number(config.get('NEMO_ALIVE_INTERVAL_MINUTES') ?? 60);
  const alive = async (): Promise<void> => {
    try {
      const r = await status.aliveCheck();
      logger.log(r ? `nemo alive: ${r.ok ? 'up' : 'DOWN'} (${r.httpStatus ?? 'no answer'}, ${r.ms} ms)` : 'nemo alive: skipped — mock target or no key');
    } catch (error) {
      logger.warn(`nemo alive: ${error instanceof Error ? error.message : String(error)}`);
    }
    // GISIS facility list freshness (docs/specs/0053): a daily reminder
    // email while the platform-admin upload is more than 3 months old — its
    // 20 h resend guard keeps the hourly check to one email a day.
    await refdata
      .maybeAlertGisisStale()
      .catch((error) =>
        logger.warn(
          `gisis staleness check: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };
  const aliveTimer = setInterval(() => void alive(), aliveMinutes * 60_000);

  // The visit watch (spec 0097): our visits someone cancelled in NEMO — unlinked
  // here, the org's admins told. Hourly by default; 0 turns it off.
  const visitWatch = app.get(VisitWatchService);
  const watchMinutes = Number(config.get('NEMO_VISIT_WATCH_MINUTES') ?? 60);
  let watching = false;
  const watch = async (): Promise<void> => {
    if (watching) return; // a slow round never overlaps the next
    watching = true;
    try {
      const r = await visitWatch.run();
      logger.log(
        `visit watch: ${r.checked} visit(s) in ${r.orgs} org(s), ${r.unlinked.length} cancelled in NEMO` +
          (r.unlinked.length ? ` (${r.unlinked.map((c) => c.visitId).join(', ')})` : '') +
          (r.skipped.length ? `; skipped ${r.skipped.map((x) => `${x.org}: ${x.why}`).join('; ')}` : ''),
      );
    } catch (error) {
      logger.warn(`visit watch: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      watching = false;
    }
  };
  const watchTimer = watchMinutes > 0 ? setInterval(() => void watch(), watchMinutes * 60_000) : null;
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    timers.forEach((t) => clearTimeout(t));
    clearInterval(aliveTimer);
    if (watchTimer) clearInterval(watchTimer);
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // eslint-disable-next-line no-console
  console.log('nemolink-worker up — reference lists weekly Monday 12:00 Helsinki, ships daily 05:00 UTC');
  await alive();
  if (watchTimer) void watch();
  if (config.get('REFDATA_SYNC_ON_BOOT') !== 'false') await cycle(SYNC_JOBS);
  schedule('reference lists', SYNC_JOBS.filter((job) => job !== 'ships'), nextWeeklySlot);
  schedule('ship master list', ['ships'], nextDailyShipsSlot);
}

void bootstrap().catch((error: unknown) => {
  // A migration failure crash-loops the container rather than working against
  // a schema we know is wrong (spec 0058).
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
