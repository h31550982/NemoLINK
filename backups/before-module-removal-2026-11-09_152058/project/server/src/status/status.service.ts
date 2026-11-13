/**
 * System status (spec 0082): one light in the page header — green, yellow,
 * red — over four parts: NEMO, the organisation's integrations, NEMOLink
 * itself, and the external lists. And the hourly NEMO alive check the
 * worker runs, recorded as a tracked run (platform.sync_run, job
 * 'nemo_alive') and one short line in the platform audit log.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { NemoApiError, NemoClientService } from '../nemo-client/nemo-client.service';
import { explainFailure, statusWords } from '../nemo-client/nemo-exchange';
import { TenantDb } from '../tenancy/tenant-db';

export type Light = 'green' | 'yellow' | 'red';

export interface StatusItem {
  key: 'nemo' | 'integrations' | 'system' | 'lists';
  label: string;
  light: Light;
  words: string;
  at: string | null;
}

export interface SystemStatus {
  light: Light;
  items: StatusItem[];
  checkedAt: string;
}

const HOUR = 60 * 60 * 1000;
/** An integration that has sent nothing for this long is yellow, then red (user rule 2026-09-26). */
export const INTEGRATION_YELLOW_MS = 2 * HOUR;
export const INTEGRATION_RED_MS = 12 * HOUR;
/** No NEMO evidence for this long: the alive check is not running. */
const NEMO_STALE_MS = 3 * HOUR;
/** The worker's daily cycle plus slack. */
const WORKER_STALE_MS = 26 * HOUR;

const RANK: Record<Light, number> = { green: 0, yellow: 1, red: 2 };
export function worst(lights: Light[]): Light {
  return lights.reduce<Light>((w, l) => (RANK[l] > RANK[w] ? l : w), 'green');
}

function ago(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Down = NEMO not reached: 5xx, 429, or no answer at all. A 400 means NEMO is alive. */
function nemoDown(httpStatus: number | null | undefined, ok: boolean): boolean {
  if (ok) return false;
  return httpStatus === null || httpStatus === undefined || httpStatus >= 500 || httpStatus === 429;
}

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tenantDb: TenantDb,
    private readonly nemo: NemoClientService,
    private readonly audit: AuditService,
  ) {}

  // ---- the alive check (worker, hourly) -------------------------------------------

  /**
   * One light authenticated read — the port call list for a one-day window,
   * with the key of an organisation that has one on this target. Never
   * unauthenticated, never the production host without a key (08-security).
   */
  async aliveCheck(): Promise<{ ok: boolean; httpStatus: number | null; ms: number } | null> {
    const target = this.nemo.target;
    if (target === 'mock') return null;
    const org = await this.pool.query<{ slug: string }>(
      `SELECT o.slug FROM platform.nemo_credential c
         JOIN platform.organization o ON o.id = c.org_id
        WHERE c.is_active AND c.nemo_target = $1
        ORDER BY c.updated DESC LIMIT 1`,
      [target],
    );
    const slug = org.rows[0]?.slug;
    if (!slug) return null;

    const run = await this.pool.query<{ id: string }>(
      `INSERT INTO platform.sync_run (job, author) VALUES ('nemo_alive', 'worker') RETURNING id`,
    );
    const started = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    const next = new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 10);
    let ok = false;
    let httpStatus: number | null = null;
    let words = '';
    try {
      await this.nemo.getPortCalls(slug, { timeWindowStart: day, timeWindowEnd: next });
      ok = true;
      httpStatus = 200;
      words = 'NEMO answered';
    } catch (error) {
      const f = explainFailure(error);
      httpStatus = error instanceof NemoApiError ? error.status : null;
      // A refusal of the read itself (4xx) still proves NEMO is up
      ok = !nemoDown(httpStatus, false);
      words = f.headline;
    }
    const ms = Date.now() - started;
    const stats = { target, org: slug, httpStatus, ms, words };
    await this.pool.query(
      `UPDATE platform.sync_run SET status = $2, finished = now(), stats = $3::jsonb, error = $4 WHERE id = $1`,
      [run.rows[0]!.id, ok ? 'ok' : 'failed', JSON.stringify(stats), ok ? null : `${statusWords(httpStatus)}: ${words}`],
    );
    await this.audit
      .content({
        actorId: 'worker',
        entityType: 'nemo_alive',
        entityId: target,
        data: { action: 'nemo_alive_check', ok, httpStatus, ms },
      })
      .catch((e: unknown) => this.logger.warn(`alive check audit: ${e instanceof Error ? e.message : String(e)}`));
    return { ok, httpStatus, ms };
  }

  // ---- the light ------------------------------------------------------------------

  async status(orgSlug: string | null): Promise<SystemStatus> {
    const now = Date.now();
    const items: StatusItem[] = [];
    items.push(await this.nemoItem(now));
    if (orgSlug) {
      const integrations = await this.integrationsItem(orgSlug, now);
      if (integrations) items.push(integrations);
    }
    items.push(await this.systemItem(now));
    items.push(await this.listsItem());
    return { light: worst(items.map((i) => i.light)), items, checkedAt: new Date(now).toISOString() };
  }

  /** The latest word about NEMO: the alive check, or any real exchange, whichever is newer. */
  private async nemoItem(now: number): Promise<StatusItem> {
    const target = this.nemo.target;
    const label = `NEMO${target === 'stg' ? ' (staging)' : ''}`;
    if (target === 'mock') {
      return { key: 'nemo', label, light: 'green', words: 'The NEMO mock — no live NEMO in this environment', at: null };
    }
    const alive = await this.pool.query<{ at: Date; status: string; stats: { httpStatus?: number | null } }>(
      `SELECT COALESCE(finished, started) AS at, status, stats FROM platform.sync_run
        WHERE job = 'nemo_alive' AND status <> 'running' ORDER BY started DESC LIMIT 1`,
    );
    const used = await this.pool.query<{ at: Date; data: { status?: string; httpStatus?: number | null } }>(
      `SELECT created AS at, data FROM platform.audit_event
        WHERE entity_type = 'nemo_submission' AND data->>'phase' = 'outcome' AND data->>'target' = $1
        ORDER BY seq DESC LIMIT 1`,
      [target],
    );
    const a = alive.rows[0];
    const u = used.rows[0];
    const fromAlive = a ? { at: a.at, ok: a.status === 'ok', httpStatus: a.stats?.httpStatus ?? null, how: 'the hourly check' } : null;
    const fromUse = u
      ? { at: u.at, ok: !nemoDown(u.data.httpStatus ?? null, u.data.status === 'ok'), httpStatus: u.data.httpStatus ?? null, how: 'a send' }
      : null;
    const latest = [fromAlive, fromUse].filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => y.at.getTime() - x.at.getTime())[0];
    if (!latest) return { key: 'nemo', label, light: 'yellow', words: 'Not checked yet', at: null };
    const at = latest.at.toISOString();
    if (!latest.ok) {
      return {
        key: 'nemo',
        label,
        light: 'red',
        words: `NEMO is down currently — ${latest.how} ${ago(now - latest.at.getTime())} got ${statusWords(latest.httpStatus)}`,
        at,
      };
    }
    if (now - latest.at.getTime() > NEMO_STALE_MS) {
      return { key: 'nemo', label, light: 'yellow', words: `No word from NEMO since ${ago(now - latest.at.getTime())}`, at };
    }
    return { key: 'nemo', label, light: 'green', words: `NEMO answered ${ago(now - latest.at.getTime())}`, at };
  }

  /** The org's own data feeds (opsDesk and the like): only when it has one. */
  private async integrationsItem(orgSlug: string, now: number): Promise<StatusItem | null> {
    const creds = await this.pool.query<{ source_system: string }>(
      `SELECT DISTINCT c.source_system FROM platform.ingest_credential c
         JOIN platform.organization o ON o.id = c.org_id
        WHERE o.slug = $1 AND c.is_active`,
      [orgSlug],
    );
    const sources = creds.rows.map((r) => r.source_system);
    if (sources.length === 0) return null;
    const last = await this.tenantDb.withOrg(orgSlug, (client) =>
      client.query<{ source_system: string; at: Date }>(
        `SELECT source_system, max(received_at) AS at FROM source_record
          WHERE source_system = ANY($1::text[]) GROUP BY source_system`,
        [sources],
      ),
    );
    const byName = new Map(last.rows.map((r) => [r.source_system, r.at]));
    const parts = sources.map((s) => {
      const at = byName.get(s) ?? null;
      const age = at ? now - at.getTime() : Infinity;
      const light: Light = age > INTEGRATION_RED_MS ? 'red' : age > INTEGRATION_YELLOW_MS ? 'yellow' : 'green';
      return { s, at, light, words: at ? `${s}: last data ${ago(age)}` : `${s}: no data received yet` };
    });
    const newest = parts.map((p) => p.at).filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0];
    return {
      key: 'integrations',
      label: 'Integrations',
      light: worst(parts.map((p) => p.light)),
      words: parts.map((p) => p.words).join(' · '),
      at: newest ? newest.toISOString() : null,
    };
  }

  /** NEMOLink itself: the database answers (this runs on it) and the worker runs. */
  private async systemItem(now: number): Promise<StatusItem> {
    const r = await this.pool.query<{ at: Date | null }>(
      `SELECT max(started) AS at FROM platform.sync_run WHERE author = 'worker'`,
    );
    const at = r.rows[0]?.at ?? null;
    if (!at || now - at.getTime() > WORKER_STALE_MS) {
      return {
        key: 'system',
        label: 'NEMOLink',
        light: 'yellow',
        words: at ? `Server and database up; the background worker last ran ${ago(now - at.getTime())}` : 'Server and database up; the background worker has not run',
        at: at ? at.toISOString() : null,
      };
    }
    return { key: 'system', label: 'NEMOLink', light: 'green', words: 'Server, database and background worker running', at: at.toISOString() };
  }

  /** NEMO's published lists and contracts: the last run of each sync. */
  private async listsItem(): Promise<StatusItem> {
    const r = await this.pool.query<{ job: string; status: string; stats: Record<string, unknown>; at: Date }>(
      `SELECT DISTINCT ON (job) job, status, stats, started AS at FROM platform.sync_run
        WHERE job IN ('schemas', 'codelists', 'hsmap', 'locations', 'hazmat', 'ships') AND status <> 'running'
        ORDER BY job, started DESC`,
    );
    const failed = r.rows.filter((x) => x.status === 'failed').map((x) => x.job);
    const schemas = r.rows.find((x) => x.job === 'schemas');
    const drift = schemas
      ? [
          ...((schemas.stats['changed'] as string[] | undefined) ?? []),
          ...((schemas.stats['newUpstream'] as string[] | undefined) ?? []),
          ...((schemas.stats['removedUpstream'] as string[] | undefined) ?? []),
        ]
      : [];
    const newest = r.rows.map((x) => x.at).sort((x, y) => y.getTime() - x.getTime())[0];
    const words: string[] = [];
    if (drift.length) words.push(`NEMO changed ${drift.length} contract file(s) upstream — adoption needed`);
    if (failed.length) words.push(`last run failed: ${failed.join(', ')}`);
    return {
      key: 'lists',
      label: 'NEMO lists and contracts',
      light: drift.length || failed.length ? 'yellow' : 'green',
      words: words.length ? words.join(' · ') : r.rows.length ? 'Up to date' : 'Not synced yet',
      at: newest ? newest.toISOString() : null,
    };
  }
}
