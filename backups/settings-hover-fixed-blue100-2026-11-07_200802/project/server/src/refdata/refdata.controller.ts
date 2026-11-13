/**
 * Reference-data browse + sync endpoints (docs/specs/0021) — admins only.
 * Read paths serve the admin tables (server-side search: the datasets are far
 * too large for client-side filtering); POST sync/:job is "Run now".
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Pool } from 'pg';
import { Authz } from '../auth/authz.decorator';
import { SessionUser } from '../auth/session.service';
import { PG_POOL } from '../db/db.module';
import {
  RefdataSyncService,
  SyncJob,
  SyncRunResult,
  SYNC_JOBS,
} from './refdata-sync.service';

type AuthedRequest = Request & { user: SessionUser };

/** Same escaping as the audit search (spec 0019): % _ \ become literals. */
function likePattern(q: string): string {
  return '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
}

function searchParam(q: string | undefined): string | null {
  return (q ?? '').trim().slice(0, 200) || null;
}

export interface SyncRunRow {
  id: string;
  job: string;
  status: string;
  started: string;
  finished: string | null;
  stats: Record<string, unknown>;
  error: string | null;
  author: string | null;
}

@Controller('refdata')
@Authz('session:admin')
export class RefdataController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly sync: RefdataSyncService,
  ) {}

  @Get('codelists')
  async codelists(): Promise<{
    codelists: { codelist: string; version: string; entries: number; updated: string }[];
  }> {
    const rows = await this.pool.query(
      `SELECT codelist, version, count(*)::int AS entries, max(updated) AS updated
         FROM platform.codelist_entry WHERE is_active
        GROUP BY codelist, version ORDER BY codelist`,
    );
    return {
      codelists: rows.rows.map((r) => ({
        codelist: r.codelist,
        version: r.version,
        entries: r.entries,
        updated: r.updated.toISOString(),
      })),
    };
  }

  @Get('codelists/:name')
  async codelistEntries(
    @Param('name') name: string,
    @Query('q') q?: string,
  ): Promise<{
    entries: {
      code: string;
      en: string | null;
      fi: string | null;
      sv: string | null;
      national: boolean;
      fiPreferred: boolean;
    }[];
    total: number;
  }> {
    // Hub list names include uppercase (directive_2009_42_ec_annex_II_1)
    if (!/^[A-Za-z0-9_]{1,100}$/.test(name)) {
      throw new BadRequestException('Invalid codelist name');
    }
    const query = searchParam(q);
    const pattern = query ? likePattern(query) : null;
    const where = `codelist = $1 AND is_active AND ($2::text IS NULL
        OR code ILIKE $2 OR COALESCE(en, '') ILIKE $2
        OR COALESCE(fi, '') ILIKE $2 OR COALESCE(sv, '') ILIKE $2)`;
    const [entries, total] = await Promise.all([
      this.pool.query(
        `SELECT code, en, fi, sv, national, fi_preferred AS "fiPreferred"
           FROM platform.codelist_entry
          WHERE ${where} ORDER BY code LIMIT 200`,
        [name, pattern],
      ),
      this.pool.query(
        `SELECT count(*)::int AS total FROM platform.codelist_entry WHERE ${where}`,
        [name, pattern],
      ),
    ]);
    return { entries: entries.rows, total: total.rows[0]?.total ?? 0 };
  }

  @Get('locations')
  async locations(@Query('q') q?: string): Promise<{
    locations: {
      locode: string;
      name: string | null;
      countryCode: string | null;
      data: Record<string, unknown>;
      updated: string;
    }[];
    total: number;
  }> {
    const query = searchParam(q);
    const pattern = query ? likePattern(query) : null;
    const where = `is_active AND ($1::text IS NULL OR locode ILIKE $1
        OR COALESCE(name, '') ILIKE $1 OR COALESCE(country_code, '') ILIKE $1)`;
    const [rows, total] = await Promise.all([
      this.pool.query(
        `SELECT locode, name, country_code, data, updated FROM platform.location
          WHERE ${where} ORDER BY locode LIMIT 100`,
        [pattern],
      ),
      this.pool.query(
        `SELECT count(*)::int AS total FROM platform.location WHERE ${where}`,
        [pattern],
      ),
    ]);
    return {
      locations: rows.rows.map((r) => ({
        locode: r.locode,
        name: r.name,
        countryCode: r.country_code,
        data: r.data,
        updated: r.updated.toISOString(),
      })),
      total: total.rows[0]?.total ?? 0,
    };
  }

  @Get('hazmat')
  async hazmat(@Query('q') q?: string): Promise<{
    items: {
      hazmatId: string;
      properShippingName: string | null;
      undgNumber: string | null;
      hazardClass: string | null;
      updated: string;
    }[];
    total: number;
  }> {
    const query = searchParam(q);
    const pattern = query ? likePattern(query) : null;
    // The service row id (IMDG_1765_10240, …) is an internal key with a
    // counter in it — searching it made "1024" return ten unrelated rows
    // (user decision 2026-09-24). Name, UN number and hazard class only.
    const where = `is_active AND ($1::text IS NULL
        OR COALESCE(proper_shipping_name, '') ILIKE $1
        OR COALESCE(undg_number, '') ILIKE $1
        OR COALESCE(hazard_class, '') ILIKE $1)`;
    const [rows, total] = await Promise.all([
      this.pool.query(
        `SELECT hazmat_id, proper_shipping_name, undg_number, hazard_class, updated
           FROM platform.hazmat_item WHERE ${where}
          ORDER BY hazmat_id LIMIT 100`,
        [pattern],
      ),
      this.pool.query(
        `SELECT count(*)::int AS total FROM platform.hazmat_item WHERE ${where}`,
        [pattern],
      ),
    ]);
    return {
      items: rows.rows.map((r) => ({
        hazmatId: r.hazmat_id,
        properShippingName: r.proper_shipping_name,
        undgNumber: r.undg_number,
        hazardClass: r.hazard_class,
        updated: r.updated.toISOString(),
      })),
      total: total.rows[0]?.total ?? 0,
    };
  }

  @Get('hsmap')
  async hsMap(): Promise<{
    entries: {
      groupCode: string;
      groupLabel: string | null;
      refinement: string;
      hs6: string;
      hsName: string | null;
      updated: string;
    }[];
  }> {
    // ~46 rows total — served whole, filtered client-side. The English name
    // joins from the synced hs_cargo_item codelist (spec 0021).
    const rows = await this.pool.query(
      `SELECT m.group_code, m.group_label, m.refinement, m.hs6,
              ce.en AS hs_name, m.updated
         FROM platform.hs_map m
         LEFT JOIN platform.codelist_entry ce
           ON ce.codelist = 'hs_cargo_item' AND ce.code = m.hs6 AND ce.is_active
        WHERE m.is_active
        ORDER BY m.group_code, m.refinement`,
    );
    return {
      entries: rows.rows.map((r) => ({
        groupCode: r.group_code,
        groupLabel: r.group_label,
        refinement: r.refinement,
        hs6: r.hs6,
        hsName: r.hs_name,
        updated: r.updated.toISOString(),
      })),
    };
  }

  @Get('contracts')
  contracts(): {
    contracts: { file: string; source: string; sha256: string; sourceSha256: string | null }[];
  } {
    // The exact vendored contract versions the system validates against
    // (spec 0025) — straight from the manifest the schema watch uses.
    return {
      contracts: this.sync.watchedFiles().map((e) => ({
        file: e.file,
        source: e.source,
        sha256: e.sha256,
        sourceSha256: e.sourceSha256 ?? null,
      })),
    };
  }

  @Get('sync/status')
  async syncStatus(): Promise<{
    datasets: {
      job: string;
      rows: number;
      available: boolean;
      reason?: string;
      lastOk: string | null;
    }[];
    runs: SyncRunRow[];
  }> {
    const [counts, lastOk, runs] = await Promise.all([
      this.pool.query(
        `SELECT
           (SELECT count(*)::int FROM platform.codelist_entry WHERE is_active) AS codelists,
           (SELECT count(*)::int FROM platform.hs_map WHERE is_active) AS hsmap,
           (SELECT count(*)::int FROM platform.location WHERE is_active) AS locations,
           (SELECT count(*)::int FROM platform.hazmat_item WHERE is_active) AS hazmat,
           (SELECT count(*)::int FROM platform.ship WHERE is_active) AS ships`,
      ),
      this.pool.query(
        `SELECT DISTINCT ON (job) job, finished FROM platform.sync_run
          WHERE status = 'ok' ORDER BY job, started DESC`,
      ),
      this.pool.query(
        `SELECT id, job, status, started, finished, stats, error, author
           FROM platform.sync_run ORDER BY started DESC LIMIT 50`,
      ),
    ]);
    const okByJob = new Map<string, Date | null>(
      lastOk.rows.map((r) => [r.job, r.finished]),
    );
    const rowCounts = counts.rows[0] ?? { codelists: 0, hsmap: 0, locations: 0, hazmat: 0, ships: 0 };
    // 'schemas' rows = vendored contract files under watch, not DB rows
    rowCounts.schemas = this.sync.watchedFileCount();
    return {
      datasets: SYNC_JOBS.map((job) => {
        const avail = this.sync.availability(job);
        return {
          job,
          rows: rowCounts[job] ?? 0,
          available: avail.available,
          ...(avail.reason ? { reason: avail.reason } : {}),
          lastOk: okByJob.get(job)?.toISOString() ?? null,
        };
      }),
      runs: runs.rows.map((r) => ({
        id: r.id,
        job: r.job,
        status: r.status,
        started: r.started.toISOString(),
        finished: r.finished ? r.finished.toISOString() : null,
        stats: r.stats,
        error: r.error,
        author: r.author,
      })),
    };
  }

  @Post('sync/:job')
  @HttpCode(200)
  async runSync(
    @Req() req: AuthedRequest,
    @Param('job') job: string,
  ): Promise<{ run: SyncRunResult }> {
    if (!(SYNC_JOBS as string[]).includes(job)) {
      throw new BadRequestException('Unknown sync job');
    }
    return { run: await this.sync.run(job as SyncJob, req.user.username) };
  }
}
