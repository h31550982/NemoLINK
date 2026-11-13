/**
 * Spec 0014 — welcome email on approval, resend guards, compact template.
 */
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import { UserApprovalService } from '../src/auth/user-approval.service';
import type { SessionUser } from '../src/auth/session.service';
import { brandedEmail } from '../src/notify/email-template';
import type { NotifyService } from '../src/notify/notify.service';
import type { TenantDb } from '../src/tenancy/tenant-db';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

function makeService(overrides: {
  queryResults: Array<{ rowCount?: number; rows: unknown[] }>;
  emailEnabled?: boolean;
  sendTracked?: jest.Mock;
}) {
  const query = jest.fn();
  for (const r of overrides.queryResults) {
    query.mockResolvedValueOnce({ rowCount: r.rows.length, ...r });
  }
  const sendTracked =
    overrides.sendTracked ??
    jest.fn().mockResolvedValue({ emailMessageId: 'm1', status: 'sent' });
  const service = new UserApprovalService(
    { query } as unknown as Pool,
    { get: () => 'https://nemolink.nauticai.net' } as unknown as ConfigService,
    { content: jest.fn() } as unknown as AuditService,
    {
      emailEnabled: overrides.emailEnabled ?? true,
      sendTracked,
    } as unknown as NotifyService,
    { withOrg: jest.fn() } as unknown as TenantDb,
  );
  return { service, query, sendTracked };
}

describe('approve() sends the welcome email (spec 0014 AC 2)', () => {
  const approvedRow = {
    id: 'u1',
    username: 'new.user@acmeship.example',
    email: 'new.user@acmeship.example',
    auth_type: 'oidc',
  };

  it('sends user-welcome linked to the user id when email is enabled', async () => {
    const { service, sendTracked } = makeService({
      queryResults: [{ rows: [approvedRow] }],
    });
    await service.approve(ADMIN, 'u1', 'viewer');
    expect(sendTracked).toHaveBeenCalledTimes(1);
    const call = sendTracked.mock.calls[0][0];
    expect(call.template).toBe('user-welcome');
    expect(call.relatedEntityType).toBe('user_account');
    expect(call.relatedEntityId).toBe('u1');
    expect(call.to).toBe('new.user@acmeship.example');
    expect(call.author).toBe(ADMIN.username);
    expect(call.subject).toContain('access is ready');
  });

  it('approval succeeds even when the send throws', async () => {
    const { service, sendTracked } = makeService({
      queryResults: [{ rows: [approvedRow] }],
      sendTracked: jest.fn().mockRejectedValue(new Error('SES down')),
    });
    await expect(service.approve(ADMIN, 'u1', 'viewer')).resolves.toBeUndefined();
    expect(sendTracked).toHaveBeenCalled();
  });

  it('skips silently when the account has no email', async () => {
    const { service, sendTracked } = makeService({
      queryResults: [{ rows: [{ ...approvedRow, email: null }] }],
    });
    await service.approve(ADMIN, 'u1', 'captain');
    expect(sendTracked).not.toHaveBeenCalled();
  });

  it('skips silently when email is disabled (local dev)', async () => {
    const { service, sendTracked } = makeService({
      queryResults: [{ rows: [approvedRow] }],
      emailEnabled: false,
    });
    await service.approve(ADMIN, 'u1', 'viewer');
    expect(sendTracked).not.toHaveBeenCalled();
  });
});

describe('resendWelcome() guards (spec 0014 AC 3)', () => {
  const activeUser = {
    id: 'u1',
    email: 'user@acmeship.example',
    auth_type: 'oidc',
    role: 'viewer',
    status: 'active',
  };

  it('unknown or cross-org user -> 404', async () => {
    const { service } = makeService({ queryResults: [{ rows: [] }] });
    await expect(service.resendWelcome(ADMIN, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('non-active user -> 400', async () => {
    const { service } = makeService({
      queryResults: [{ rows: [{ ...activeUser, status: 'pending' }] }],
    });
    await expect(service.resendWelcome(ADMIN, 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('no email address -> 400', async () => {
    const { service } = makeService({
      queryResults: [{ rows: [{ ...activeUser, email: null }] }],
    });
    await expect(service.resendWelcome(ADMIN, 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('email disabled -> 503', async () => {
    const { service } = makeService({
      queryResults: [{ rows: [activeUser] }],
      emailEnabled: false,
    });
    await expect(service.resendWelcome(ADMIN, 'u1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('suppressed recipient surfaces as 400, not 500', async () => {
    const { service } = makeService({
      queryResults: [{ rows: [activeUser] }],
      sendTracked: jest
        .fn()
        .mockRejectedValue(new Error('Recipient is on the suppression list')),
    });
    await expect(service.resendWelcome(ADMIN, 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('success returns the notify status with the admin as author', async () => {
    const { service, sendTracked } = makeService({
      queryResults: [{ rows: [activeUser] }],
    });
    await expect(service.resendWelcome(ADMIN, 'u1')).resolves.toBe('sent');
    expect(sendTracked.mock.calls[0][0].author).toBe(ADMIN.username);
  });
});

describe('compact template (spec 0014 AC 1)', () => {
  const rendered = brandedEmail({
    title: 'Your NEMOLink access is ready',
    paragraphs: ['An administrator approved your access.'],
    facts: [
      { label: 'Organization', value: 'Acmeship Oy' },
      { label: 'Role', value: 'viewer' },
    ],
    cta: { text: 'Open NEMOLink', url: 'https://nemolink.nauticai.net' },
  });

  it('renders facts as label-above-value boxes', () => {
    expect(rendered.htmlBody).toContain('text-transform:uppercase');
    expect(rendered.htmlBody).toContain('Organization');
    expect(rendered.htmlBody).toContain('Acmeship Oy');
    // label and value stacked in the same cell, not side-by-side columns
    expect(rendered.htmlBody).toMatch(
      /uppercase[^<]*">Organization<\/div>\s*<div[^>]*font-weight:700/,
    );
  });

  it('centers the CTA button', () => {
    expect(rendered.htmlBody).toMatch(/<td align="center">\s*<table/);
    expect(rendered.htmlBody).toContain('Open NEMOLink');
  });

  it('still references no external resources', () => {
    expect(rendered.htmlBody).not.toMatch(/<img|<link|@import|url\(/);
    expect(rendered.htmlBody).not.toMatch(/src=/);
  });
});
