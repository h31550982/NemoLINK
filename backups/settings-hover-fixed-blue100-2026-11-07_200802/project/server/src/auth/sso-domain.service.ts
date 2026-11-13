/**
 * Home-realm discovery (docs/specs/0057): which email domains sign in through
 * SSO. `organization.auth_config->'ssoDomains'` is the source; the login page
 * asks before it attempts a local sign-in, so an SSO user typing their work
 * address gets pointed at the SSO button instead of a generic failure.
 *
 * No-oracle rule (spec 0011) holds: this answers about a DOMAIN, never about
 * a user. The caller must already know the domain to learn that it federates,
 * and nothing here touches user_account.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** The endpoint is public; one refresh a minute keeps probes off the DB. */
const CACHE_MS = 60_000;

@Injectable()
export class SsoDomainService {
  private readonly logger = new Logger(SsoDomainService.name);
  private cache: { domains: Set<string>; at: number } | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The domain of a well-formed address, lowercased; null for anything else. */
  static domainOf(username: string): string | null {
    const at = username.trim().toLowerCase();
    const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(at);
    return match?.[1] ?? null;
  }

  /** True only for an email address whose domain an active org has claimed. */
  async isSsoLogin(username: string): Promise<boolean> {
    const domain = SsoDomainService.domainOf(username);
    if (!domain) return false;
    return (await this.domains()).has(domain);
  }

  private async domains(): Promise<Set<string>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.domains;
    }
    try {
      const result = await this.pool.query(
        `SELECT DISTINCT lower(trim(d)) AS domain
           FROM platform.organization o,
                LATERAL jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(o.auth_config->'ssoDomains') = 'array'
                       THEN o.auth_config->'ssoDomains'
                       ELSE '[]'::jsonb END) AS d
          WHERE o.is_active AND trim(d) <> ''`,
      );
      const domains = new Set<string>(
        result.rows.map((r: { domain: string }) => r.domain),
      );
      this.cache = { domains, at: Date.now() };
      return domains;
    } catch (error) {
      // Fail closed on the hint, open on the login: no hint, form still works.
      // The failure takes the cache slot too — a public endpoint must not turn
      // a database outage into one query per request.
      this.logger.error(
        `sso domain load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      const domains = this.cache?.domains ?? new Set<string>();
      this.cache = { domains, at: Date.now() };
      return domains;
    }
  }
}
