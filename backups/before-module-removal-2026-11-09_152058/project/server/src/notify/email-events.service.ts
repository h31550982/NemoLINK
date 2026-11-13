/**
 * Turns SES event notifications into email_message lifecycle updates and
 * suppression-list entries. Adapted from the prior project's ingest logic to
 * nemolink's platform schema (docs/specs/0003-notify-email-events.md).
 *
 * Unknown MessageIds are a normal, expected no-op — the AWS account (and
 * potentially the SNS topic) is shared with other projects; we simply ignore
 * events that are not ours.
 *
 * audit.email events wired per spec 0007 (best effort — the webhook must keep
 * answering 200 either way). Lifecycle state lives on platform.email_message.
 * Platform-level DB access — tenant-scoped repositories (invariant 1) do not
 * apply to the shared platform schema.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';

export type SesEventType =
  | 'Delivery'
  | 'Bounce'
  | 'Complaint'
  | 'Reject'
  | 'DeliveryDelay';

/** SES event payload, narrowed to the fields we consume. */
export interface SesEventPayload {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; timestamp?: string };
  delivery?: { timestamp?: string; recipients?: string[] };
  bounce?: {
    timestamp?: string;
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: Array<{
      emailAddress?: string;
      diagnosticCode?: string;
      status?: string;
    }>;
  };
  complaint?: {
    timestamp?: string;
    complaintFeedbackType?: string;
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
  reject?: { reason?: string };
  deliveryDelay?: {
    timestamp?: string;
    delayType?: string;
    delayedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }>;
  };
}

const HANDLED_TYPES: SesEventType[] = [
  'Delivery',
  'Bounce',
  'Complaint',
  'Reject',
  'DeliveryDelay',
];

/** Lifecycle transition per event type; null = record the event, keep status. */
const STATUS_BY_EVENT: Record<SesEventType, string | null> = {
  Delivery: 'delivered',
  Bounce: 'bounced',
  Complaint: 'complained',
  Reject: 'failed',
  DeliveryDelay: null,
};

@Injectable()
export class EmailEventsService {
  private readonly logger = new Logger(EmailEventsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  /**
   * Ingest one SES event. Never throws — the webhook must answer 200 so SNS
   * does not retry a message we simply cannot use.
   */
  async ingest(payload: SesEventPayload): Promise<{ handled: boolean }> {
    try {
      return await this.ingestInner(payload);
    } catch (error) {
      this.logger.error(
        `SES event ingest failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { handled: false };
    }
  }

  private async ingestInner(
    payload: SesEventPayload,
  ): Promise<{ handled: boolean }> {
    const eventType = (payload.eventType ?? payload.notificationType) as
      | SesEventType
      | undefined;
    if (!eventType || !HANDLED_TYPES.includes(eventType)) {
      return { handled: false };
    }

    const messageId = payload.mail?.messageId;
    if (!messageId) {
      return { handled: false };
    }

    const event = {
      eventType,
      at: new Date().toISOString(),
      detail: this.eventDetail(eventType, payload),
    };
    const newStatus = STATUS_BY_EVENT[eventType];

    // Append the event; move the lifecycle forward. 'delivered' only follows
    // 'sent' (a late delivery report must not overwrite bounced/complained);
    // bounce/complaint/reject are terminal and always win.
    const result = await this.pool.query(
      `UPDATE platform.email_message
         SET data = jsonb_set(data, '{events}',
                      COALESCE(data->'events', '[]'::jsonb) || $2::jsonb),
             status = CASE
               WHEN $3::text IS NULL THEN status
               WHEN $3 = 'delivered' AND status <> 'sent' THEN status
               ELSE $3
             END,
             updated = now()
       WHERE ses_message_id = $1 AND is_active
       RETURNING id, recipient, status`,
      [messageId, JSON.stringify(event), newStatus],
    );

    if (result.rowCount === 0) {
      // Not ours (shared account/topic) — normal, expected no-op.
      return { handled: false };
    }

    await this.auditEmail({
      entityType: 'email_message',
      entityId: result.rows[0].id,
      actorId: 'ses-events',
      data: {
        action: eventType.toLowerCase(),
        detail: event.detail,
        status: result.rows[0].status,
      },
    });

    if (this.shouldSuppress(eventType, payload)) {
      for (const address of this.affectedAddresses(eventType, payload)) {
        await this.suppress(
          address,
          eventType === 'Bounce' ? 'bounce' : 'complaint',
          event.detail,
        );
      }
    }

    this.logger.log(
      `SES event ingested: ${eventType} → status ${result.rows[0].status}`,
    );
    return { handled: true };
  }

  private eventDetail(
    eventType: SesEventType,
    payload: SesEventPayload,
  ): Record<string, unknown> {
    switch (eventType) {
      case 'Delivery':
        return { timestamp: payload.delivery?.timestamp };
      case 'Bounce':
        return {
          timestamp: payload.bounce?.timestamp,
          bounceType: payload.bounce?.bounceType,
          bounceSubType: payload.bounce?.bounceSubType,
        };
      case 'Complaint':
        return {
          timestamp: payload.complaint?.timestamp,
          feedbackType: payload.complaint?.complaintFeedbackType,
        };
      case 'Reject':
        return { reason: payload.reject?.reason };
      case 'DeliveryDelay':
        return {
          timestamp: payload.deliveryDelay?.timestamp,
          delayType: payload.deliveryDelay?.delayType,
        };
    }
  }

  /** Permanent bounces and all complaints feed the suppression list. */
  private shouldSuppress(
    eventType: SesEventType,
    payload: SesEventPayload,
  ): boolean {
    if (eventType === 'Complaint') {
      return true;
    }
    return eventType === 'Bounce' && payload.bounce?.bounceType === 'Permanent';
  }

  private affectedAddresses(
    eventType: SesEventType,
    payload: SesEventPayload,
  ): string[] {
    const recipients =
      eventType === 'Bounce'
        ? payload.bounce?.bouncedRecipients
        : payload.complaint?.complainedRecipients;
    return (recipients ?? [])
      .map((r) => r.emailAddress)
      .filter((a): a is string => !!a);
  }

  private async suppress(
    address: string,
    reason: 'bounce' | 'complaint',
    detail: Record<string, unknown>,
  ): Promise<void> {
    // Partial unique index on lower(address) WHERE is_active needs the matching
    // conflict target; insert-if-absent keeps the first reason.
    await this.pool.query(
      `INSERT INTO platform.email_suppression (address, reason, detail, author)
       SELECT $1, $2, $3::jsonb, 'ses-events'
       WHERE NOT EXISTS (
         SELECT 1 FROM platform.email_suppression
         WHERE lower(address) = lower($1) AND is_active
       )`,
      [address, reason, JSON.stringify(detail)],
    );
    this.logger.warn(`Address suppressed (${reason})`);
    await this.auditEmail({
      entityType: 'email_suppression',
      actorId: 'ses-events',
      data: { action: 'suppressed', address, reason, detail },
    });
  }

  /**
   * Best effort (spec 0007): the SES fact is already recorded on
   * email_message; a failed audit write is logged loudly, never thrown —
   * the webhook must still answer 200.
   */
  private async auditEmail(entry: {
    entityType: string;
    entityId?: string;
    actorId?: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.audit.email(entry);
    } catch (error) {
      this.logger.error(
        `audit email write failed (${String(entry.data.action)}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Send-time gate: true when the address must not be mailed. */
  async isSuppressed(address: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM platform.email_suppression
       WHERE lower(address) = lower($1) AND is_active`,
      [address],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
