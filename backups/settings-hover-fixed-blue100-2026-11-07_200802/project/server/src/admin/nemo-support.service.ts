/**
 * "Send to NEMOLink support" (spec 0081): the result viewer's exchange —
 * what was asked, NEMO's answer decoded, the raw request and response —
 * emailed in the house style to support, the reporter in cc. Subject:
 * customer, visit id, outcome, operation. The report itself is audited on
 * the port call's chain (or the org chain without a call).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/session.service';
import { NemoClientService } from '../nemo-client/nemo-client.service';
import { statusWords } from '../nemo-client/nemo-exchange';
import { brandedEmail } from '../notify/email-template';
import { NotifyService } from '../notify/notify.service';
import { TenantDb } from '../tenancy/tenant-db';

export const SUPPORT_EMAIL = 'support@nauticai.com';

/** Raw bodies are cut to this many characters in the email (the chain keeps them whole). */
const BODY_LIMIT = 24 * 1024;

const errorSchema = z.object({
  code: z.string().max(200).nullable(),
  message: z.string().max(2000).nullable(),
  path: z.string().max(500).nullable(),
});

export const supportReportSchema = z
  .object({
    exchange: z
      .object({
        operation: z.string().min(1).max(40),
        outcome: z.enum(['success', 'rejected', 'unavailable', 'error']),
        visitId: z.string().max(40).nullable(),
        portCallId: z.string().uuid().nullable(),
        httpStatus: z.number().int().min(100).max(599).nullable(),
        frmStatus: z.string().max(10).nullable(),
        headline: z.string().max(500),
        explanation: z.string().max(4000),
        errors: z.array(errorSchema).max(50),
        at: z.string().max(40),
        request: z.unknown(),
        response: z.unknown(),
        auditId: z.string().max(80).nullable(),
      })
      .strict(),
    note: z.string().max(2000).optional(),
  })
  .strict();
export type SupportReport = z.infer<typeof supportReportSchema>;

const OUTCOME_FLAG: Record<SupportReport['exchange']['outcome'], string> = {
  success: 'Success',
  rejected: 'Rejected',
  unavailable: 'NEMO unavailable',
  error: 'Error',
};

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '(nothing — no answer)';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n… (${text.length} characters, cut; the audit event keeps it whole)` : text;
}

@Injectable()
export class NemoSupportService {
  constructor(
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly tenantDb: TenantDb,
    private readonly nemo: NemoClientService,
  ) {}

  async report(viewer: SessionUser, input: SupportReport): Promise<{ sentTo: string; cc: string }> {
    const x = input.exchange;
    const reporter = viewer.username;
    if (!reporter.includes('@')) throw new BadRequestException('Your account has no email address to copy');
    const customer = viewer.orgName || viewer.orgSlug;
    const flag = OUTCOME_FLAG[x.outcome];
    const subject = `NEMOLink support · ${customer} · ${x.visitId ?? 'no visit id'} · ${flag} · ${x.operation}`;

    const facts = [
      { label: 'Customer', value: `${customer} (${viewer.orgSlug})` },
      { label: 'Reported by', value: `${viewer.displayName ?? reporter} <${reporter}>` },
      { label: 'Visit id', value: x.visitId ?? 'none yet' },
      { label: 'Operation', value: x.operation },
      { label: 'Outcome', value: flag },
      { label: 'NEMO answered', value: statusWords(x.httpStatus) + (x.frmStatus ? ` · FRM status ${x.frmStatus}` : '') },
      { label: 'At', value: x.at },
      { label: 'NEMO environment', value: this.nemo.target },
      ...(x.portCallId ? [{ label: 'Port call id', value: x.portCallId }] : []),
      ...(x.auditId ? [{ label: 'Audit event', value: x.auditId }] : []),
    ];
    const errors = x.errors.map((e) => [e.code, e.message, e.path ? `(${e.path})` : null].filter(Boolean).join(' '));
    const { htmlBody, textBody } = brandedEmail({
      title: `${x.operation} — ${x.headline}`,
      paragraphs: [
        ...(x.explanation ? [x.explanation] : []),
        ...(errors.length ? [`NEMO's errors: ${errors.join('; ')}`] : []),
        ...(input.note?.trim() ? [`Note from ${viewer.displayName ?? reporter}: ${input.note.trim()}`] : []),
        `${reporter} is in copy; reply to all to reach them.`,
      ],
      facts,
      blocks: [
        { label: 'Request NEMOLink sent', text: pretty(x.request) },
        { label: 'Response NEMO gave', text: pretty(x.response) },
      ],
    });

    const sent = await this.notify.sendTracked({
      to: SUPPORT_EMAIL,
      cc: reporter,
      replyTo: reporter,
      subject,
      htmlBody,
      textBody,
      template: 'nemo_support_report',
      relatedEntityType: x.portCallId ? 'port_call' : 'organization',
      relatedEntityId: x.portCallId ?? viewer.orgSlug,
      author: reporter,
    });
    if (sent.status !== 'sent') {
      throw new BadRequestException(`The email could not be sent${sent.error ? `: ${sent.error}` : ''}`);
    }

    const schema = await this.tenantDb.schemaFor(viewer.orgSlug);
    await this.audit.content({
      actorId: reporter,
      entityType: x.portCallId ? 'port_call' : 'organization',
      entityId: x.portCallId ?? viewer.orgSlug,
      data: {
        action: 'nemo_support_report',
        operation: x.operation,
        outcome: x.outcome,
        visitId: x.visitId,
        exchangeAuditId: x.auditId,
        emailMessageId: sent.emailMessageId,
        subject,
      },
      schema,
    });
    return { sentTo: SUPPORT_EMAIL, cc: reporter };
  }
}
