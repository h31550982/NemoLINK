/**
 * notify v0 — tracked direct send (docs/specs/0003-notify-email-events.md).
 *
 * Suppression check → email_message row ('queued') → SES send with the
 * configuration set → 'sent' + ses_message_id (or 'failed' + error detail).
 *
 * The SES gate is SES-only, deliberately decoupled from any S3 configuration
 * (the prior project's config only enabled email when S3_BUCKET was also set —
 * a documented trap, see the AWS walkthrough).
 *
 * Deferred to the worker spec: the transactional-outbox dispatcher.
 * audit.email events wired per spec 0007: 'queued' before the SES call (fail
 * closed — no audit, no email), 'sent'/'failed' after (best effort).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { EmailEventsService } from './email-events.service';
import { isEmailConfigured, sendRawEmail, type SesConfig } from './ses-client';

export interface SendEmailInput {
  to: string;
  /** Copy to (spec 0081: the reporter of a support report). */
  cc?: string;
  /** Where replies go — defaults to the configured reply-to. */
  replyTo?: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  template?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  author?: string;
}

export interface SendEmailResult {
  emailMessageId: string;
  status: 'sent' | 'failed';
  sesMessageId?: string;
  error?: string;
}

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly events: EmailEventsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Env lookup that treats '' as absent. The zod schema already normalizes
   * empty strings, but ConfigService.get() falls back to raw process.env where
   * compose-passed empties survive — an '' reply-to would otherwise reach SES
   * as ReplyToAddresses: [''] ("Invalid email address .").
   */
  private str(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return value ? value : undefined;
  }

  private sesConfig(): SesConfig | undefined {
    const candidate: Partial<SesConfig> = {
      region: this.str('AWS_REGION'),
      fromEmail: this.str('AWS_SES_FROM_EMAIL'),
      replyToEmail: this.str('AWS_SES_REPLY_TO_EMAIL'),
      accessKeyId: this.str('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.str('AWS_SECRET_ACCESS_KEY'),
      configurationSetName: this.str('AWS_SES_CONFIGURATION_SET'),
    };
    return isEmailConfigured(candidate) ? candidate : undefined;
  }

  get emailEnabled(): boolean {
    return this.sesConfig() !== undefined;
  }

  /**
   * Send one tracked email (platform-level; tenant flows arrive with tenancy).
   * Throws on suppressed recipients and missing configuration — callers decide
   * how to surface that; nothing here is fire-and-forget.
   */
  async sendTracked(input: SendEmailInput): Promise<SendEmailResult> {
    const ses = this.sesConfig();
    if (!ses) {
      throw new Error(
        'SES not configured (AWS_REGION + AWS_SES_FROM_EMAIL required)',
      );
    }

    if (await this.events.isSuppressed(input.to)) {
      throw new Error(`Recipient is on the suppression list`);
    }

    const inserted = await this.pool.query(
      `INSERT INTO platform.email_message
         (recipient, template, subject, status, related_entity_type,
          related_entity_id, author)
       VALUES ($1, $2, $3, 'queued', $4, $5, $6)
       RETURNING id`,
      [
        input.to,
        input.template ?? null,
        input.subject,
        input.relatedEntityType ?? null,
        input.relatedEntityId ?? null,
        input.author ?? 'notify',
      ],
    );
    const emailMessageId: string = inserted.rows[0].id;

    // Fail closed (spec 0007): no audit, no email. Mark the message failed so
    // the 'queued' row does not read as a send that silently vanished.
    try {
      await this.audit.email({
        entityType: 'email_message',
        entityId: emailMessageId,
        actorId: input.author ?? 'notify',
        data: {
          action: 'queued',
          recipient: input.to,
          subject: input.subject,
          template: input.template ?? null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool
        .query(
          `UPDATE platform.email_message
             SET status = 'failed',
                 data = jsonb_set(data, '{error}', to_jsonb($1::text)),
                 updated = now()
           WHERE id = $2`,
          [`audit unavailable: ${message}`, emailMessageId],
        )
        .catch(() => undefined);
      throw new Error(`Audit write failed; email not sent: ${message}`);
    }

    try {
      const result = await sendRawEmail(ses, {
        to: input.to,
        ...(input.cc ? { cc: input.cc } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody,
      });
      await this.pool.query(
        `UPDATE platform.email_message
           SET status = 'sent', ses_message_id = $1, updated = now()
         WHERE id = $2`,
        [result.messageId ?? null, emailMessageId],
      );
      this.logger.log(`Email sent (message ${result.messageId ?? 'unknown'})`);
      await this.auditOutcome(emailMessageId, {
        action: 'sent',
        sesMessageId: result.messageId ?? null,
      });
      return {
        emailMessageId,
        status: 'sent',
        ...(result.messageId && { sesMessageId: result.messageId }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query(
        `UPDATE platform.email_message
           SET status = 'failed',
               data = jsonb_set(data, '{error}', to_jsonb($1::text)),
               updated = now()
         WHERE id = $2`,
        [message, emailMessageId],
      );
      this.logger.error(`Email send failed: ${message}`);
      await this.auditOutcome(emailMessageId, { action: 'failed', error: message });
      return { emailMessageId, status: 'failed', error: message };
    }
  }

  /** Outcome events are best effort — the send already happened (spec 0007). */
  private async auditOutcome(
    emailMessageId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.email({
        entityType: 'email_message',
        entityId: emailMessageId,
        data,
      });
    } catch (error) {
      this.logger.error(
        `audit email outcome write failed for ${emailMessageId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
