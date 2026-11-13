/**
 * "Send to NEMOLink support" (spec 0081): the exchange emailed to support in
 * the house style, the reporter in cc, the subject naming customer, visit id,
 * outcome and operation; the report audited.
 */
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import { NemoSupportService, SUPPORT_EMAIL, supportReportSchema } from '../src/admin/nemo-support.service';
import type { NemoClientService } from '../src/nemo-client/nemo-client.service';
import type { NotifyService } from '../src/notify/notify.service';
import type { TenantDb } from '../src/tenancy/tenant-db';

const ADMIN = {
  id: 'admin-1',
  username: 'admin@fleetco.example',
  displayName: 'Ada Admin',
  role: 'admin',
  orgSlug: 'fleetco',
  orgName: 'Fleetco Oy',
} as SessionUser;

const EXCHANGE = {
  operation: 'SID',
  outcome: 'unavailable' as const,
  visitId: 'FI20260925-024-2',
  portCallId: '0b0c3e1e-1111-4a4a-8888-222222222222',
  httpStatus: 503,
  frmStatus: null,
  headline: 'NEMO is unavailable — nothing was sent',
  explanation: "NEMO's sign-in service answered 503 Service Unavailable.",
  errors: [],
  at: '2026-09-26T09:46:00.000Z',
  request: { 'env:Envelope': { 'sid:SID': {} } },
  response: null,
  auditId: 'audit-9',
};

function harness(status: 'sent' | 'failed' = 'sent') {
  const sendTracked = jest.fn(async () => ({
    emailMessageId: 'em-1',
    status,
    ...(status === 'failed' ? { error: 'SES down' } : {}),
  }));
  const content = jest.fn(async () => 'audit-2');
  const service = new NemoSupportService(
    { sendTracked } as unknown as NotifyService,
    { content } as unknown as AuditService,
    { schemaFor: jest.fn(async () => 'org_fleetco') } as unknown as TenantDb,
    { target: 'stg' } as unknown as NemoClientService,
  );
  return { service, sendTracked, content };
}

describe('support report (spec 0081)', () => {
  it('emails support with the reporter in cc, the flagged subject, the facts and both raw bodies', async () => {
    const h = harness();
    await expect(h.service.report(ADMIN, { exchange: EXCHANGE, note: 'Tried twice' })).resolves.toEqual({
      sentTo: SUPPORT_EMAIL,
      cc: 'admin@fleetco.example',
    });
    const mail = (h.sendTracked.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(mail).toMatchObject({
      to: 'support@nauticai.com',
      cc: 'admin@fleetco.example',
      replyTo: 'admin@fleetco.example',
      subject: 'NEMOLink support · Fleetco Oy · FI20260925-024-2 · NEMO unavailable · SID',
      template: 'nemo_support_report',
    });
    expect(mail['textBody']).toContain('503 Service Unavailable');
    expect(mail['textBody']).toContain('Request NEMOLink sent:');
    expect(mail['textBody']).toContain('"sid:SID"');
    expect(mail['textBody']).toContain('Tried twice');
    expect(mail['htmlBody']).toContain('<pre');
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'port_call',
        data: expect.objectContaining({ action: 'nemo_support_report', exchangeAuditId: 'audit-9' }),
      }),
    );
  });

  it('a failed email is said, and not audited as sent', async () => {
    const h = harness('failed');
    await expect(h.service.report(ADMIN, { exchange: EXCHANGE })).rejects.toThrow(/could not be sent: SES down/);
    expect(h.content).not.toHaveBeenCalled();
  });

  it('the schema refuses unknown fields and oversized words', () => {
    expect(supportReportSchema.safeParse({ exchange: { ...EXCHANGE, extra: 1 } }).success).toBe(false);
    expect(supportReportSchema.safeParse({ exchange: { ...EXCHANGE, headline: 'x'.repeat(501) } }).success).toBe(false);
    expect(supportReportSchema.safeParse({ exchange: EXCHANGE }).success).toBe(true);
  });
});
