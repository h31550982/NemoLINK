/**
 * The visit watch (docs/specs/0097): hourly, the worker reads NEMO's formality
 * list of every port call an organisation has in NEMO and is not done with
 * (not departed, not cancelled here). A visit NEMO cancelled — someone made
 * a COA in the NEMO UI, or another system did — is unlinked here exactly as
 * a send would find it (canonical/visit-unlink), and the organisation's
 * admins get one email per run naming the calls.
 *
 * One call at a time per organisation; NEMO not reached (or no key) stops
 * that organisation's round quietly and the next run tries again. Nothing is
 * ever sent to NEMO from here — reads only.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { unlinkVisit, visitCancelledIn } from '../canonical/visit-unlink';
import { PG_POOL } from '../db/db.module';
import { NemoApiError, NemoClientService } from '../nemo-client/nemo-client.service';
import { brandedEmail } from '../notify/email-template';
import { NotifyService } from '../notify/notify.service';
import { TenantDb } from '../tenancy/tenant-db';

export const WATCH_ACTOR = 'nemolink-worker';

export interface WatchedCall {
  id: string;
  visitId: string;
  shipId: string | null;
  shipName: string | null;
  portLocode: string | null;
  eta: string | null;
}

export interface UnlinkedCall extends WatchedCall {
  reason: string;
}

export interface WatchRun {
  orgs: number;
  checked: number;
  unlinked: UnlinkedCall[];
  /** Organisations whose round stopped: NEMO not reached, no key, … */
  skipped: { org: string; why: string }[];
}

@Injectable()
export class VisitWatchService {
  private readonly logger = new Logger(VisitWatchService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tenantDb: TenantDb,
    private readonly nemo: NemoClientService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly config: ConfigService,
  ) {}

  /** One round over every active organisation. */
  async run(): Promise<WatchRun> {
    const out: WatchRun = { orgs: 0, checked: 0, unlinked: [], skipped: [] };
    if (this.nemo.target === 'mock') return out;
    for (const org of await this.tenantDb.activeOrgs()) {
      out.orgs++;
      const calls = await this.tenantDb.withOrg(org.slug, (client) =>
        client.query(
          `SELECT pc.id, pc.visit_id, pc.ship_id, s.name AS ship_name, pc.port_locode, pc.eta
             FROM port_call pc LEFT JOIN platform.ship s ON s.id = pc.ship_id
            WHERE pc.visit_id IS NOT NULL
              AND COALESCE(pc.status, 'expected') NOT IN ('departed', 'cancelled')
            ORDER BY pc.eta NULLS LAST`,
        ),
      );
      if (calls.rows.length === 0) continue;
      const unlinkedHere: UnlinkedCall[] = [];
      for (const r of calls.rows) {
        const call: WatchedCall = {
          id: r.id,
          visitId: r.visit_id,
          shipId: r.ship_id ?? null,
          shipName: r.ship_name ?? null,
          portLocode: r.port_locode ?? null,
          eta: r.eta ? new Date(r.eta).toISOString() : null,
        };
        let reason: string | null = null;
        try {
          const list = await this.nemo.getFormalities(org.slug, call.visitId);
          out.checked++;
          if (visitCancelledIn(list)) reason = 'cancelled in NEMO';
        } catch (error) {
          if (error instanceof NemoApiError && error.status === 404) {
            out.checked++;
            reason = 'visit not found in NEMO (HTTP 404)';
          } else if (error instanceof NemoApiError && error.status === 400) {
            // NEMO answers an unknown visit id 400 BAD_REQUEST (STG 2026-10-06) — but a 400
            // is not proof the visit is gone, so it is left linked and only logged
            out.checked++;
            this.logger.warn(`visit watch ${org.slug}: NEMO answered 400 for ${call.visitId} — left linked`);
            continue;
          } else {
            // NEMO down, no key, sign-in refused: this org's round ends; the next run retries
            out.skipped.push({ org: org.slug, why: error instanceof Error ? error.message : String(error) });
            break;
          }
        }
        if (!reason) continue;
        const done = await this.tenantDb.withOrg(org.slug, (client) =>
          unlinkVisit(client, this.audit, {
            actorId: WATCH_ACTOR,
            portCallId: call.id,
            visitId: call.visitId,
            shipId: call.shipId,
            reason: `${reason} (visit watch)`,
            schema: org.schema,
          }),
        );
        if (done) unlinkedHere.push({ ...call, reason: reason! });
      }
      if (unlinkedHere.length > 0) {
        out.unlinked.push(...unlinkedHere);
        await this.tell(org.slug, unlinkedHere);
      }
    }
    return out;
  }

  /** One email to the organisation's admins naming the calls NEMO cancelled. */
  private async tell(orgSlug: string, calls: UnlinkedCall[]): Promise<void> {
    if (!this.notify.emailEnabled) {
      this.logger.warn(`visit watch ${orgSlug}: ${calls.length} visit(s) cancelled in NEMO — email disabled, nobody told`);
      return;
    }
    const admins = await this.pool.query<{ email: string }>(
      `SELECT u.email FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
        WHERE o.slug = $1 AND u.role = 'admin' AND u.status = 'active'
          AND u.is_active AND u.email IS NOT NULL`,
      [orgSlug],
    );
    if (admins.rows.length === 0) {
      this.logger.warn(`visit watch ${orgSlug}: ${calls.length} visit(s) cancelled in NEMO — no admin email to tell`);
      return;
    }
    const base = this.config.get<string>('PUBLIC_BASE_URL') || 'https://nemolink.nauticai.net';
    const one = calls.length === 1 ? calls[0]! : null;
    const name = (c: WatchedCall): string => `${c.shipName ?? 'Ship'} · ${c.portLocode ?? '—'}`;
    const { htmlBody, textBody } = brandedEmail({
      title: one ? `NEMO cancelled the port call of ${name(one)}` : `NEMO cancelled ${calls.length} port calls`,
      paragraphs: [
        'Someone cancelled these visits in NEMO — in the NEMO user interface or from another system, not from NEMOLink.',
        'NEMOLink has unlinked each port call from its cancelled visit: its VID is unsent again. ' +
          'If the call is still on, create it in NEMO anew from NEMOLink; if not, cancel it in NEMOLink too.',
      ],
      facts: calls.map((c) => ({
        label: `${name(c)}${c.eta ? ` · ETA ${c.eta.slice(0, 16).replace('T', ' ')} UTC` : ''}`,
        value: c.visitId,
      })),
      cta: { text: 'Open NEMOLink', url: base },
    });
    for (const { email } of admins.rows) {
      try {
        await this.notify.sendTracked({
          to: email,
          subject: one
            ? `NEMOLink: NEMO cancelled ${one.visitId} (${name(one)})`
            : `NEMOLink: NEMO cancelled ${calls.length} port calls`,
          htmlBody,
          textBody,
          template: 'nemo-visit-cancelled',
          relatedEntityType: 'port_call',
          relatedEntityId: calls[0]!.id,
          author: WATCH_ACTOR,
        });
      } catch (error) {
        this.logger.error(`visit watch ${orgSlug}: email to an admin failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
