/**
 * Reference-data sync (docs/specs/0021): codelists from the vendored
 * sources, locations from the hub's published full dataset (docs/specs/0027 —
 * public static file, like the schema watch), hazmat from the Fintraffic
 * hazmat service via nemo-client (invariant 4).
 *
 * One run = one platform.sync_run row. Runs of the same job are mutually
 * exclusive across processes (API "run now" + worker schedule) via a session
 * advisory lock held on a dedicated connection for the whole run; a crashed
 * process releases its lock automatically and the next run marks the stale
 * 'running' row failed. All upserts of a run commit atomically together with
 * the final status and its platform-chain audit event — a failed run leaves
 * no half-written dataset behind. Syncs are additive only: rows are never
 * deactivated (a short or mock response must not wipe a real dataset —
 * removal handling arrives with the EMSA/coverage decision, spec 0021).
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import {
  DIGITRAFFIC_LANE,
  applyLaneToResolved,
  lanesOf,
  withLane,
} from '../canonical/ship-lanes';
import { nemoSnapshotOf, NSD_REFUSED_WORDS, nsdReadIntoData } from '../canonical/ship-nemo';
import { PG_POOL } from '../db/db.module';
import { NemoApiError, NemoClientService } from '../nemo-client/nemo-client.service';
import {
  DigitrafficFetcher,
  DigitrafficVisit,
  digitrafficUser,
  digitrafficVisitsUrl,
  fetchDigitraffic,
  parseDigitrafficVisits,
  upcomingImos,
} from './digitraffic';
import { brandedEmail } from '../notify/email-template';
import { NotifyService } from '../notify/notify.service';
import {
  GISIS_STALE_DAYS,
  GisisCsvError,
  GisisParseResult,
  gisisStale,
  importGisisFacilities,
  parseGisisCsv,
} from './gisis';
import { loadHsMap } from './hs-map';
import { loadHubCodelists } from './hub-codelists';
import { parseHubLocations } from './hub-locations';
import {
  aliasSource,
  parseLocationAliases,
} from './location-aliases';
import { loadSpreadsheetCodelists } from './spreadsheet-codelists';
import {
  fetchTextWithRetry,
  loadManifest,
  watchSchemas,
  type Fetcher,
  type ManifestEntry,
  type SchemaWatchResult,
} from './schema-watch';

export type SyncJob = 'schemas' | 'codelists' | 'hsmap' | 'locations' | 'hazmat' | 'ships';
export const SYNC_JOBS: SyncJob[] = ['schemas', 'codelists', 'hsmap', 'locations', 'hazmat', 'ships'];

/** The NSD scan of one ships run looks up at most this many hulls, one at a time. */
const NSD_SCAN_CAP = 200;
/** A snapshot younger than this is not read again by the scan. */
const SNAPSHOT_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Everything that records a platform.sync_run row. 'gisis' (docs/specs/0053)
 * is tracked but never scheduled: its data arrives as a platform-admin upload,
 * so it stays out of SYNC_JOBS (no worker cycle, no org-admin "Run now").
 */
export type TrackedJob = SyncJob | 'gisis';

export interface SyncRunResult {
  id: string;
  job: TrackedJob;
  status: 'ok' | 'failed';
  started: string;
  finished: string;
  stats: Record<string, unknown>;
  error: string | null;
}

export interface JobAvailability {
  available: boolean;
  reason?: string;
}

/** GISIS list health (docs/specs/0053): the platform tab + the reminder. */
export interface GisisStatus {
  facilities: number;
  /** Codes no longer in the latest uploads — kept, flagged, never offered. */
  retired: number;
  countries: number;
  lastImport: {
    id: string;
    finished: string;
    author: string | null;
    stats: Record<string, unknown>;
  } | null;
  staleAfterDays: number;
  stale: boolean;
}

const AUTHOR = 'refdata-sync';

@Injectable()
export class RefdataSyncService {
  private readonly logger = new Logger(RefdataSyncService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly nemo: NemoClientService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Whether a job can run at all right now. "Not configured" is a normal
   * state, not a failure: the scheduler skips it and the UI explains what is
   * missing — no failed-run noise while STG onboarding is pending.
   */
  availability(job: SyncJob): JobAvailability {
    // schemas + locations = public hub fetches; codelists/hsmap = offline
    // vendored seeds (locations moved to the hub dataset — docs/specs/0027)
    if (job !== 'hazmat') return { available: true };
    if (!this.nemo.refdataBase('hazmat')) {
      return {
        available: false,
        reason:
          `Waiting for configuration: set ${this.nemo.refdataUrlVar('hazmat')} ` +
          `for target "${this.nemo.target}" (stg and prd find the service on their own host; ` +
          "the mock target needs the local mock's address).",
      };
    }
    // nauticAi holds no NEMO key of its own (spec 0059), so this platform-wide
    // reference read has to borrow a customer's. Which org is named
    // explicitly — never picked for us, and visible in that org's audit trail.
    if (this.nemo.target !== 'mock' && !this.refdataOrgSlug()) {
      return {
        available: false,
        reason:
          'Waiting for configuration: set NEMO_REFDATA_ORG_SLUG to the org whose ' +
          `NEMO credential the hazmat sync borrows on target "${this.nemo.target}" ` +
          '(docs/specs/0059).',
      };
    }
    return { available: true };
  }

  /** Org whose vaulted credential the platform-level hazmat read uses. */
  private refdataOrgSlug(): string | null {
    const value = this.config.get<string>('NEMO_REFDATA_ORG_SLUG');
    return value ? value : null;
  }

  /** Runs one job now. 409 when the job is already running, 503 when unconfigured. */
  async run(job: SyncJob, actor: string): Promise<SyncRunResult> {
    const avail = this.availability(job);
    if (!avail.available) {
      throw new ServiceUnavailableException(avail.reason);
    }
    return this.runTracked(job, actor, (client) => this.execute(job, client));
  }

  /**
   * The shared run lifecycle (docs/specs/0021): advisory lock, stale-running
   * cleanup, one sync_run row, atomic finish + audit event. The GISIS upload
   * (docs/specs/0053) rides the same tracks with data from a file instead of
   * execute().
   */
  private async runTracked(
    job: TrackedJob,
    actor: string,
    exec: (client: PoolClient) => Promise<Record<string, unknown>>,
  ): Promise<SyncRunResult> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const lock = await client.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`,
        [`refdata:${job}`],
      );
      locked = lock.rows[0]?.ok === true;
      if (!locked) {
        throw new ConflictException(`A ${job} sync is already running`);
      }

      // Holding the lock proves no live run exists — any 'running' row is a
      // leftover from a process that died mid-run.
      await client.query(
        `UPDATE platform.sync_run
            SET status = 'failed', finished = now(),
                error = 'stale: no finish recorded (process died mid-run)'
          WHERE job = $1 AND status = 'running'`,
        [job],
      );
      const runRow = (
        await client.query<{ id: string; started: Date }>(
          `INSERT INTO platform.sync_run (job, author) VALUES ($1, $2)
           RETURNING id, started`,
          [job, actor],
        )
      ).rows[0]!;

      let stats: Record<string, unknown> = {};
      let error: string | null = null;
      await client.query('BEGIN');
      try {
        stats = await exec(client);
        const fin = await this.finish(client, runRow.id, job, actor, 'ok', stats, null);
        await client.query('COMMIT');
        if (job === 'schemas') {
          // Best-effort alert AFTER the run is committed — an email hiccup
          // must never take the bookkeeping down with it.
          await this.maybeAlertSchemaDrift(runRow.id, stats).catch((err) =>
            this.logger.error(
              `schema drift alert failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
        return this.result(runRow, job, 'ok', stats, null, fin);
      } catch (err) {
        await client.query('ROLLBACK');
        error = err instanceof Error ? err.message : String(err);
        this.logger.warn(`${job} sync failed: ${error}`);
      }
      // Failure bookkeeping in its own transaction (the data rollback above
      // must not take the run row + audit event down with it).
      await client.query('BEGIN');
      try {
        const fin = await this.finish(client, runRow.id, job, actor, 'failed', stats, error);
        await client.query('COMMIT');
        return this.result(runRow, job, 'failed', stats, error, fin);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      if (locked) {
        await client
          .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [`refdata:${job}`])
          .catch(() => undefined);
      }
      client.release();
    }
  }

  /** Final status update + platform-chain audit event, same transaction. */
  private async finish(
    client: PoolClient,
    runId: string,
    job: TrackedJob,
    actor: string,
    status: 'ok' | 'failed',
    stats: Record<string, unknown>,
    error: string | null,
  ): Promise<string> {
    const updated = await client.query<{ finished: Date }>(
      `UPDATE platform.sync_run
          SET status = $2, finished = now(), stats = $3::jsonb, error = $4
        WHERE id = $1
        RETURNING finished`,
      [runId, status, JSON.stringify(stats), error],
    );
    await this.audit.content(
      {
        actorId: actor,
        entityType: 'refdata_sync',
        entityId: runId,
        data: { job, status, stats, ...(error ? { error } : {}) },
      },
      client,
    );
    return updated.rows[0]!.finished.toISOString();
  }

  private result(
    runRow: { id: string; started: Date },
    job: TrackedJob,
    status: 'ok' | 'failed',
    stats: Record<string, unknown>,
    error: string | null,
    finished: string,
  ): SyncRunResult {
    return {
      id: runRow.id,
      job,
      status,
      started: runRow.started.toISOString(),
      finished,
      stats,
      error,
    };
  }

  // ---- the jobs ------------------------------------------------------------

  private async execute(
    job: SyncJob,
    client: PoolClient,
  ): Promise<Record<string, unknown>> {
    switch (job) {
      case 'schemas':
        return watchSchemas(this.vendorDir());
      case 'codelists':
        return this.syncCodelists(client);
      case 'hsmap':
        return this.syncHsMap(client);
      case 'locations':
        return this.syncLocations(client);
      case 'hazmat':
        return this.syncHazmat(client);
      case 'ships':
        return this.syncShips(client);
    }
  }

  // ---- the ship master list (docs/specs/0068) --------------------------------

  /** Replaceable for tests; the default sends the two headers Digitraffic wants. */
  digitrafficFetcher: DigitrafficFetcher = fetchDigitraffic;

  /**
   * Grow the master list from Digitraffic's active visits (the NEMO-fed feed),
   * then ask NEMO's ship database about the ships with upcoming calls — the
   * self-healing pass of spec 0068. The Digitraffic step needs nothing; the
   * NSD step borrows NEMO_REFDATA_ORG_SLUG's key and is skipped, with the
   * reason in the stats, when there is none or the target is mock.
   */
  private async syncShips(client: PoolClient): Promise<Record<string, unknown>> {
    const url = digitrafficVisitsUrl(this.config.get<string>('DIGITRAFFIC_URL'));
    const user = digitrafficUser(this.config.get<string>('DIGITRAFFIC_USER'));
    const parsed = parseDigitrafficVisits(await this.digitrafficFetcher(url, user));
    const now = new Date().toISOString();
    const stats = { visits: parsed.received, withoutImo: parsed.withoutImo, created: 0, updated: 0, unchanged: 0 };

    // The newest visit per hull is what the lane records.
    const byImo = new Map<string, DigitrafficVisit>();
    for (const v of parsed.visits) {
      if (!v.imo) continue;
      const prev = byImo.get(v.imo);
      if (!prev || Date.parse(v.updateTime) > Date.parse(prev.updateTime)) byImo.set(v.imo, v);
    }
    for (const [imo, v] of byImo) {
      const fields: Record<string, unknown> = v.name ? { name: v.name } : {};
      const meta = { receivedAt: now, occurredAt: v.updateTime, eventId: v.visitId, sourceRecordId: '' };
      const lastVisit = {
        visitId: v.visitId,
        portOfCall: v.portOfCall,
        eta: v.eta,
        etd: v.etd,
        status: v.status,
        updateTime: v.updateTime,
        seenAt: now,
      };
      const existing = await client.query<{ id: string; data: Record<string, unknown> }>(
        `SELECT id, data FROM platform.ship WHERE imo_number = $1 AND is_active`,
        [imo],
      );
      const row = existing.rows[0];
      if (!row) {
        const data = { ...withLane({}, DIGITRAFFIC_LANE, fields, meta), digitraffic: lastVisit };
        await client.query(
          `INSERT INTO platform.ship (name, imo_number, data, author, source)
           VALUES ($1, $2, $3::jsonb, $4, 'digitraffic')`,
          [v.name, imo, JSON.stringify(data), AUTHOR],
        );
        stats.created++;
        continue;
      }
      const lane = lanesOf(row.data ?? {})[DIGITRAFFIC_LANE];
      if (lane && Date.parse(v.updateTime) <= Date.parse(lane.occurredAt)) {
        stats.unchanged++;
        continue;
      }
      let data = withLane(row.data ?? {}, DIGITRAFFIC_LANE, fields, meta);
      data = { ...data, digitraffic: lastVisit };
      const landed = applyLaneToResolved(data, DIGITRAFFIC_LANE, fields);
      await client.query(
        `UPDATE platform.ship SET data = $2::jsonb,
                name = CASE WHEN $3::boolean THEN $4 ELSE name END,
                updated = now()
          WHERE id = $1`,
        [row.id, JSON.stringify(landed.data), 'name' in landed.columns, landed.columns.name ?? null],
      );
      stats.updated++;
    }

    const nsd = await this.scanNsd(client, upcomingImos(parsed.visits, Date.now()));
    return { ...stats, nsd };
  }

  /**
   * Ask NSD about the hulls with upcoming calls, plus any master ship that
   * sits in some fleet without a snapshot; a snapshot younger than a day is
   * left alone. One lookup at a time, capped, and three NEMO errors in a
   * row end the pass — the next run picks up where this one stopped.
   */
  private async scanNsd(client: PoolClient, upcoming: string[]): Promise<Record<string, unknown>> {
    const org = this.refdataOrgSlug();
    if (this.nemo.target === 'mock') {
      return { skipped: true, reason: 'no NEMO ship database on the mock target' };
    }
    if (!org) {
      return { skipped: true, reason: 'NEMO_REFDATA_ORG_SLUG unset — no credential to borrow (docs/specs/0059 §5)' };
    }
    const wanted = new Set(upcoming);
    // Schema names come from our own provisioning (validated slugs), never
    // from user input — safe in identifier position, like apply_to_tenants.
    const orgs = await client.query<{ schema_name: string }>(
      `SELECT schema_name FROM platform.organization WHERE is_active ORDER BY schema_name`,
    );
    for (const o of orgs.rows) {
      const unread = await client.query<{ imo_number: string }>(
        `SELECT s.imo_number FROM ${o.schema_name}.fleet_ship f
           JOIN platform.ship s ON s.id = f.ship_id
          WHERE f.is_active AND s.is_active AND s.imo_number IS NOT NULL
            AND NOT (s.data ? 'nemo')`,
      );
      for (const r of unread.rows) wanted.add(r.imo_number);
    }
    const stats: Record<string, unknown> = {
      candidates: wanted.size,
      looked: 0,
      found: 0,
      absent: 0,
      fresh: 0,
      errors: 0,
    };
    const n = (key: string): number => stats[key] as number;
    let failures = 0;
    for (const imo of [...wanted].slice(0, NSD_SCAN_CAP)) {
      const ship = await client.query<{ id: string; data: Record<string, unknown> }>(
        `SELECT id, data FROM platform.ship WHERE imo_number = $1 AND is_active`,
        [imo],
      );
      const row = ship.rows[0];
      if (!row) continue;
      const at = nemoSnapshotOf(row.data ?? {})?.at;
      if (at && Date.now() - Date.parse(at) < SNAPSHOT_FRESH_MS) {
        stats['fresh'] = n('fresh') + 1;
        continue;
      }
      try {
        const hits = await this.nemo.findShips(org, imo);
        const hit = hits.find((h) => h.imoid === imo);
        const record = hit?.id ? await this.nemo.getShip(org, hit.id) : null;
        const landed = nsdReadIntoData(row.data ?? {}, record);
        await client.query(
          `UPDATE platform.ship SET
             data      = $2::jsonb,
             name      = CASE WHEN $3::boolean THEN $4 ELSE name END,
             mmsi      = CASE WHEN $5::boolean THEN $6 ELSE mmsi END,
             call_sign = CASE WHEN $7::boolean THEN $8 ELSE call_sign END,
             updated   = now()
           WHERE id = $1`,
          [
            row.id,
            JSON.stringify(landed.data),
            'name' in landed.columns,
            landed.columns.name ?? null,
            'mmsi' in landed.columns,
            landed.columns.mmsi ?? null,
            'callSign' in landed.columns,
            landed.columns.callSign ?? null,
          ],
        );
        stats['looked'] = n('looked') + 1;
        stats[record ? 'found' : 'absent'] = n(record ? 'found' : 'absent') + 1;
        failures = 0;
      } catch (error) {
        stats['errors'] = n('errors') + 1;
        this.logger.warn(
          `nsd scan ${imo}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // A 403 is NEMO's edge refusing the API client outright (STG since
        // 2026-09-25): no point asking about the next hull.
        if (error instanceof NemoApiError && error.status === 403) {
          stats['stopped'] = NSD_REFUSED_WORDS;
          break;
        }
        if (++failures >= 3) {
          stats['stopped'] = 'three NEMO errors in a row';
          break;
        }
      }
    }
    if (wanted.size > NSD_SCAN_CAP) stats['capped'] = NSD_SCAN_CAP;
    return stats;
  }

  /** Vendor root (REFDATA_DIR): national-spreadsheet/ + nemo/hub/ under it. */
  private vendorDir(): string {
    return this.config.get<string>('REFDATA_DIR') || '../vendor';
  }

  /** The vendored contract files the schema watch covers (spec 0025 dialog). */
  watchedFiles(): ManifestEntry[] {
    try {
      return loadManifest(this.vendorDir());
    } catch {
      return [];
    }
  }

  /** How many vendored contract files the schema watch covers (Sync tab). */
  watchedFileCount(): number {
    return this.watchedFiles().length;
  }

  /** Drift identity: same set of drifted sources = same alert, sent once. */
  private driftSignature(stats: Record<string, unknown>): string | null {
    const drift = [
      ...((stats.changed as string[] | undefined) ?? []),
      ...((stats.newUpstream as string[] | undefined) ?? []),
      ...((stats.removedUpstream as string[] | undefined) ?? []),
    ];
    return drift.length ? JSON.stringify([...drift].sort()) : null;
  }

  /**
   * Emails the admin when the schemas watch found drift (docs/specs/0024) —
   * only when the drift set differs from the previous successful run's, so a
   * known, not-yet-adopted change does not nag daily. Unconfigured recipient
   * or SES = loud log, never a failure (the run stats + audit carry the drift).
   */
  private async maybeAlertSchemaDrift(
    runId: string,
    stats: Record<string, unknown>,
  ): Promise<void> {
    const signature = this.driftSignature(stats);
    if (!signature) return;

    const prev = await this.pool.query(
      `SELECT stats FROM platform.sync_run
        WHERE job = 'schemas' AND status = 'ok' AND id <> $1
        ORDER BY started DESC LIMIT 1`,
      [runId],
    );
    const prevStats = prev.rows[0]?.stats as Record<string, unknown> | undefined;
    if (prevStats && this.driftSignature(prevStats) === signature) {
      this.logger.warn('schema drift unchanged since the previous run — alert already sent');
      return;
    }

    const s = stats as unknown as SchemaWatchResult;
    const drifted = [
      ...s.changed.map((f) => ({ label: 'Changed', value: f })),
      ...s.newUpstream.map((f) => ({ label: 'New upstream', value: f })),
      ...s.removedUpstream.map((f) => ({ label: 'Removed upstream', value: f })),
    ];
    const to = this.config.get<string>('ADMIN_ALERT_EMAIL');
    if (!to) {
      this.logger.warn(
        `SCHEMA DRIFT: ${drifted.length} source(s) differ from the vendored copies ` +
          `(set ADMIN_ALERT_EMAIL to get alerts): ${drifted.map((d) => d.value).join(', ')}`,
      );
      return;
    }
    try {
      const { htmlBody, textBody } = brandedEmail({
        title: 'NEMO contracts changed upstream',
        paragraphs: [
          `The scheduled check found ${drifted.length} vendored NEMO contract ` +
            'source(s) that no longer match the published version on the NEMO ' +
            'developer hub.',
          'NEMOLink keeps validating against its reviewed copies. To adopt the ' +
            'update: re-run the vendoring fetch, review the diff, and deploy ' +
            'through the normal gates (docs/specs/0024).',
        ],
        facts: drifted.slice(0, 12),
      });
      await this.notify.sendTracked({
        to,
        subject: 'NEMOLink: NEMO schemas changed upstream',
        htmlBody,
        textBody,
        template: 'schema-drift',
        relatedEntityType: 'refdata_sync',
        relatedEntityId: runId,
        author: AUTHOR,
      });
      this.logger.log(`schema drift alert emailed to ${to}`);
    } catch (error) {
      this.logger.error(
        `schema drift email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---- GISIS port facilities (docs/specs/0053) -----------------------------

  /**
   * The platform-admin GISIS upload: parse first — a structurally broken
   * file is a 400 with no run row (rejected input leaves no durable trace,
   * spec 0008) — then the standard tracked run under job 'gisis'.
   */
  async importGisis(actor: string, csvText: string): Promise<SyncRunResult> {
    let parsed: GisisParseResult;
    try {
      parsed = parseGisisCsv(csvText);
    } catch (error) {
      if (error instanceof GisisCsvError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException(
        'No facility rows could be read from the file',
      );
    }
    return this.runTracked('gisis', actor, (client) =>
      importGisisFacilities(client, parsed, actor),
    );
  }

  async gisisStatus(): Promise<GisisStatus> {
    const counts = await this.pool.query<{
      facilities: number;
      retired: number;
      countries: number;
    }>(
      `SELECT count(*) FILTER (WHERE is_active)::int AS facilities,
              count(*) FILTER (WHERE NOT is_active)::int AS retired,
              count(DISTINCT country) FILTER (WHERE is_active)::int AS countries
         FROM platform.gisis_port_facility`,
    );
    const last = await this.pool.query(
      `SELECT id, finished, author, stats FROM platform.sync_run
        WHERE job = 'gisis' AND status = 'ok' AND finished IS NOT NULL
        ORDER BY finished DESC LIMIT 1`,
    );
    const row = last.rows[0];
    const lastImport = row
      ? {
          id: row.id as string,
          finished: (row.finished as Date).toISOString(),
          author: (row.author as string | null) ?? null,
          stats: row.stats as Record<string, unknown>,
        }
      : null;
    return {
      facilities: counts.rows[0]?.facilities ?? 0,
      retired: counts.rows[0]?.retired ?? 0,
      countries: counts.rows[0]?.countries ?? 0,
      lastImport,
      staleAfterDays: GISIS_STALE_DAYS,
      stale: gisisStale(lastImport?.finished ?? null),
    };
  }

  /**
   * The standing reminder (docs/specs/0053, user decision 2026-09-02): while
   * the GISIS list is stale (> 90 days since the last upload, or never
   * uploaded), the daily worker cycle emails the platform admin — every day,
   * deliberately unlike the schema-drift dedupe; the nag ends when someone
   * uploads. The 20 h resend guard only keeps restarts and short dev cycles
   * from doubling it. Unconfigured recipient or SES = loud log, never a
   * failure.
   */
  async maybeAlertGisisStale(): Promise<void> {
    const status = await this.gisisStatus();
    if (!status.stale) return;
    const recent = await this.pool.query(
      `SELECT 1 FROM platform.email_message
        WHERE template = 'gisis-stale' AND created > now() - interval '20 hours'
        LIMIT 1`,
    );
    if (recent.rows.length > 0) return;

    const lastDay = status.lastImport?.finished.slice(0, 10) ?? null;
    const state = lastDay ? `last upload ${lastDay}` : 'never uploaded';
    const to = this.config.get<string>('ADMIN_ALERT_EMAIL');
    if (!to) {
      this.logger.warn(
        `GISIS FACILITY LIST STALE (${state}) — set ADMIN_ALERT_EMAIL to get reminders`,
      );
      return;
    }
    try {
      const { htmlBody, textBody } = brandedEmail({
        title: 'GISIS port-facility list needs a fresh upload',
        paragraphs: [
          lastDay
            ? `The GISIS port-facility list was last uploaded on ${lastDay} — ` +
              `more than ${GISIS_STALE_DAYS} days ago.`
            : 'No GISIS port-facility export has been uploaded yet.',
          'Download a fresh Maritime Security export from GISIS ' +
            '(“Check online for latest”) and upload it on the Platform page ' +
            'under GISIS facilities. This reminder repeats daily until then.',
        ],
        facts: [
          { label: 'Last upload', value: lastDay ?? 'never' },
          { label: 'Facilities', value: String(status.facilities) },
          { label: 'Countries', value: String(status.countries) },
        ],
      });
      await this.notify.sendTracked({
        to,
        subject: 'NEMOLink: GISIS port-facility list is stale',
        htmlBody,
        textBody,
        template: 'gisis-stale',
        ...(status.lastImport
          ? {
              relatedEntityType: 'refdata_sync',
              relatedEntityId: status.lastImport.id,
            }
          : {}),
        author: AUTHOR,
      });
      this.logger.log(`GISIS staleness reminder emailed to ${to}`);
    } catch (error) {
      this.logger.error(
        `GISIS staleness email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Union of the two vendored codelist sources (docs/specs/0023, user
   * decision 2026-08-23): the hub codelists page is authoritative wherever it
   * has content (brings the FI-Preferred flags); the National Spreadsheet
   * fills the lists the page lacks or publishes empty (hs_cargo_item).
   * When a list's source version changes, the old version's rows are
   * superseded (is_active = false) — kept, never deleted.
   */
  private async syncCodelists(client: PoolClient): Promise<Record<string, unknown>> {
    const vendor = this.vendorDir();
    const hub = loadHubCodelists(vendor);
    const spreadsheet = loadSpreadsheetCodelists(join(vendor, 'national-spreadsheet'));
    const ssByName = new Map(spreadsheet.map((l) => [l.codelist, l]));
    const hubNames = new Set(hub.lists.map((l) => l.name));

    let entries = 0;
    let superseded = 0;
    for (const list of hub.lists) {
      // The spreadsheet's national flag has no hub counterpart — carry it over
      const ssEntries = new Map(
        (ssByName.get(list.name)?.entries ?? []).map((e) => [e.code, e]),
      );
      const rows = list.entries.map((e) => ({
        code: e.code,
        en: e.en,
        fi: e.fi,
        sv: e.sv,
        national: ssEntries.get(e.code)?.national ?? false,
        fiPreferred: e.fiPreferred,
      }));
      await this.upsertCodelist(client, list.name, 'hub', rows, 'nemo-hub-codelists');
      superseded += await this.supersedeOtherVersions(client, list.name, 'hub');
      entries += rows.length;
    }

    let spreadsheetLists = 0;
    for (const list of spreadsheet) {
      if (hubNames.has(list.codelist)) continue;
      const rows = list.entries.map((e) => ({ ...e, fiPreferred: false }));
      await this.upsertCodelist(
        client,
        list.codelist,
        list.version,
        rows,
        `national-spreadsheet@${list.version}`,
      );
      superseded += await this.supersedeOtherVersions(client, list.codelist, list.version);
      entries += rows.length;
      spreadsheetLists++;
    }
    return { hubLists: hub.lists.length, spreadsheetLists, entries, superseded };
  }

  private async upsertCodelist(
    client: PoolClient,
    codelist: string,
    version: string,
    rows: {
      code: string;
      en: string | null;
      fi: string | null;
      sv: string | null;
      national: boolean;
      fiPreferred: boolean;
    }[],
    source: string,
  ): Promise<void> {
    for (const chunk of chunks(rows, 500)) {
      const values: unknown[] = [];
      const tuples = chunk.map((e, i) => {
        values.push(codelist, version, e.code, e.en, e.fi, e.sv, e.national, e.fiPreferred, AUTHOR, source);
        const b = i * 10;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10})`;
      });
      await client.query(
        `INSERT INTO platform.codelist_entry
           (codelist, version, code, en, fi, sv, national, fi_preferred, author, source)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (codelist, version, code) DO UPDATE
           SET en = EXCLUDED.en, fi = EXCLUDED.fi, sv = EXCLUDED.sv,
               national = EXCLUDED.national, fi_preferred = EXCLUDED.fi_preferred,
               source = EXCLUDED.source, updated = now(), is_active = true`,
        values,
      );
    }
  }

  private async supersedeOtherVersions(
    client: PoolClient,
    codelist: string,
    version: string,
  ): Promise<number> {
    const res = await client.query(
      `UPDATE platform.codelist_entry
          SET is_active = false, updated = now()
        WHERE codelist = $1 AND version <> $2 AND is_active`,
      [codelist, version],
    );
    return res.rowCount ?? 0;
  }

  private async syncHsMap(client: PoolClient): Promise<Record<string, unknown>> {
    const entries = loadHsMap(this.vendorDir());
    const source = 'nemo-hub-hs-map';
    for (const chunk of chunks(entries, 100)) {
      const values: unknown[] = [];
      const rows = chunk.map((e, i) => {
        values.push(e.groupCode, e.groupLabel, e.refinement, e.hs6, e.hsPrinted, AUTHOR, source);
        const b = i * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
      });
      await client.query(
        `INSERT INTO platform.hs_map
           (group_code, group_label, refinement, hs6, hs_printed, author, source)
         VALUES ${rows.join(', ')}
         ON CONFLICT (group_code, refinement) WHERE is_active DO UPDATE
           SET group_label = EXCLUDED.group_label, hs6 = EXCLUDED.hs6,
               hs_printed = EXCLUDED.hs_printed, source = EXCLUDED.source,
               updated = now()`,
        values,
      );
    }
    return { entries: entries.length };
  }

  /** Overridable in tests; production uses the shared retrying hub fetcher. */
  locationsFetcher: Fetcher = fetchTextWithRetry;

  /**
   * Full worldwide LOCODE set from the hub's published dataset
   * (docs/specs/0027) — ~115k rows, so the upsert only rewrites rows that
   * actually changed (`IS DISTINCT FROM` guard): a no-change daily run
   * touches nothing and `updated` stays honest.
   */
  private async syncLocations(client: PoolClient): Promise<Record<string, unknown>> {
    const url = this.config.get<string>('NEMO_LOCATIONS_JSON_URL')
      || 'https://fintraffic-vts.github.io/mnsw/location/locations.json';
    const { rows, received, skipped } = parseHubLocations(await this.locationsFetcher(url));
    const source = 'nemo-hub-locations';
    let inserted = 0;
    let updated = 0;
    for (const chunk of chunks(rows, 1000)) {
      const values: unknown[] = [];
      const tuples = chunk.map((row, i) => {
        values.push(row.locode, row.name, row.country, JSON.stringify(row.data), AUTHOR, source);
        const b = i * 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5}, $${b + 6})`;
      });
      const result = await client.query<{ inserted: boolean }>(
        `INSERT INTO platform.location AS loc (locode, name, country_code, data, author, source)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (locode) WHERE is_active DO UPDATE
           SET name = EXCLUDED.name, country_code = EXCLUDED.country_code,
               data = EXCLUDED.data, source = EXCLUDED.source, updated = now()
           WHERE loc.name IS DISTINCT FROM EXCLUDED.name
              OR loc.country_code IS DISTINCT FROM EXCLUDED.country_code
              OR loc.data IS DISTINCT FROM EXCLUDED.data
              OR loc.source IS DISTINCT FROM EXCLUDED.source
         RETURNING (xmax = 0) AS inserted`,
        values,
      );
      for (const r of result.rows) {
        if (r.inserted) inserted++;
        else updated++;
      }
    }
    return {
      received,
      inserted,
      updated,
      unchanged: rows.length - inserted - updated,
      skipped,
      aliases: await this.syncLocationAliases(client),
    };
  }

  /**
   * Legacy and superseded LOCODEs (docs/specs/0056) — our own curated seed,
   * upserted alongside the hub locations because it is the same kind of fact
   * about the same places. Guarded like the locations upsert: a run that
   * changes nothing rewrites nothing. A malformed row is counted and named,
   * never thrown (AC 2).
   */
  private async syncLocationAliases(
    client: PoolClient,
  ): Promise<Record<string, unknown>> {
    const { rows, received, skipped, reasons } = parseLocationAliases();
    const source = aliasSource();
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const result = await client.query<{ inserted: boolean }>(
        `INSERT INTO platform.location_alias AS al
           (given_code, given_name, relation, current_code, note, evidence,
            data, author, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (COALESCE(given_code, ''), COALESCE(given_name, '')) DO UPDATE
           SET relation = EXCLUDED.relation,
               current_code = EXCLUDED.current_code,
               note = EXCLUDED.note,
               evidence = EXCLUDED.evidence,
               data = EXCLUDED.data,
               source = EXCLUDED.source,
               is_active = true,
               updated = now()
           WHERE al.relation IS DISTINCT FROM EXCLUDED.relation
              OR al.current_code IS DISTINCT FROM EXCLUDED.current_code
              OR al.note IS DISTINCT FROM EXCLUDED.note
              OR al.evidence IS DISTINCT FROM EXCLUDED.evidence
              OR al.data IS DISTINCT FROM EXCLUDED.data
              OR al.source IS DISTINCT FROM EXCLUDED.source
              OR al.is_active IS DISTINCT FROM true
         RETURNING (xmax = 0) AS inserted`,
        [
          row.givenCode,
          row.givenName,
          row.relation,
          row.currentCode,
          row.note,
          row.evidence,
          JSON.stringify(row.data),
          AUTHOR,
          source,
        ],
      );
      const hit = result.rows[0];
      if (hit?.inserted) inserted++;
      else if (hit) updated++;
    }

    return {
      received,
      inserted,
      updated,
      unchanged: rows.length - inserted - updated,
      skipped,
      ...(reasons.length > 0 ? { reasons: reasons.slice(0, 10) } : {}),
    };
  }

  private async syncHazmat(client: PoolClient): Promise<Record<string, unknown>> {
    // availability() already refused the run when this is unset off mock; the
    // mock target needs no credential and so no org.
    const received = await this.nemo.fetchHazmatItems(this.refdataOrgSlug() ?? 'mock');
    return this.persistHazmat(client, received, `nemo-hazmat-service@${this.nemo.target}`);
  }

  /**
   * Hazmat from a saved service response (spec 0062 F10): the same upsert and
   * the same run bookkeeping as the scheduled sync, with `source` naming the
   * file so the Dangerous goods tab shows where the rows came from. Bridges
   * the gap until the host itself is whitelisted for the service; needs no
   * NEMO configuration, so availability() is not consulted.
   */
  async importHazmat(items: unknown[], actor: string, label: string): Promise<SyncRunResult> {
    return this.runTracked('hazmat', actor, (client) =>
      this.persistHazmat(
        client,
        items,
        `nemo-hazmat-service@${this.nemo.target} via file ${label}`,
      ),
    );
  }

  private async persistHazmat(
    client: PoolClient,
    received: unknown[],
    source: string,
  ): Promise<Record<string, unknown>> {
    const byKey = new Map<string, Record<string, unknown>>();
    let skipped = 0;
    for (const raw of received) {
      const dto = raw as Record<string, unknown>;
      const id = typeof dto.id === 'string' ? dto.id.trim() : '';
      if (!id) {
        skipped++;
        continue;
      }
      byKey.set(id, dto);
    }
    for (const chunk of chunks([...byKey.entries()], 200)) {
      const values: unknown[] = [];
      const rows = chunk.map(([id, dto], i) => {
        values.push(
          id,
          typeof dto.properShippingName === 'string' && dto.properShippingName ? dto.properShippingName : null,
          typeof dto.UNDGnumber === 'string' && dto.UNDGnumber ? dto.UNDGnumber : null,
          typeof dto.hazardClass === 'string' && dto.hazardClass ? dto.hazardClass : null,
          JSON.stringify(dto),
          AUTHOR,
          source,
        );
        const b = i * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb, $${b + 6}, $${b + 7})`;
      });
      await client.query(
        `INSERT INTO platform.hazmat_item
           (hazmat_id, proper_shipping_name, undg_number, hazard_class, data, author, source)
         VALUES ${rows.join(', ')}
         ON CONFLICT (hazmat_id) WHERE is_active DO UPDATE
           SET proper_shipping_name = EXCLUDED.proper_shipping_name,
               undg_number = EXCLUDED.undg_number,
               hazard_class = EXCLUDED.hazard_class,
               data = EXCLUDED.data, source = EXCLUDED.source, updated = now()`,
        values,
      );
    }
    return { received: received.length, upserted: byKey.size, skipped };
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
