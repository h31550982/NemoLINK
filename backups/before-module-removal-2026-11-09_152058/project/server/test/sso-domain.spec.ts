import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { AuthController } from '../src/auth/auth.controller';
import type { LocalAuthService } from '../src/auth/local-auth.service';
import type { OidcService } from '../src/auth/oidc.service';
import type { SessionService } from '../src/auth/session.service';
import { SsoDomainService } from '../src/auth/sso-domain.service';
import type { UserApprovalService } from '../src/auth/user-approval.service';

function service(domains: string[]): { svc: SsoDomainService; query: jest.Mock } {
  const query = jest
    .fn()
    .mockResolvedValue({ rows: domains.map((domain) => ({ domain })) });
  return { svc: new SsoDomainService({ query } as unknown as Pool), query };
}

describe('SsoDomainService.domainOf (spec 0057 AC 1)', () => {
  it('returns the lowercased domain of a well-formed address', () => {
    expect(SsoDomainService.domainOf('Anna.Kapteeni@Acmeship.example')).toBe('acmeship.example');
    expect(SsoDomainService.domainOf('  a@sub.acmeship.example  ')).toBe('sub.acmeship.example');
  });

  it('returns null for anything that is not an email address', () => {
    for (const value of ['captain', '@acmeship.example', 'a@', 'a@nodot', 'a b@x.fi', 'a@x .fi']) {
      expect(SsoDomainService.domainOf(value)).toBeNull();
    }
  });
});

describe('SsoDomainService.isSsoLogin (spec 0057 AC 2/3)', () => {
  it('is true only for an address on a claimed domain', async () => {
    const { svc } = service(['acmeship.example']);
    await expect(svc.isSsoLogin(' Anna@ACMESHIP.example ')).resolves.toBe(true);
    await expect(svc.isSsoLogin('anna@elsewhere.fi')).resolves.toBe(false);
  });

  it('never queries for a value that is not an email address', async () => {
    const { svc, query } = service(['acmeship.example']);
    await expect(svc.isSsoLogin('captain')).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('loads the domain set once, not once per call', async () => {
    const { svc, query } = service(['acmeship.example']);
    await svc.isSsoLogin('a@acmeship.example');
    await svc.isSsoLogin('b@acmeship.example');
    await svc.isSsoLogin('c@elsewhere.fi');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reloads once the cache window has passed', async () => {
    const { svc, query } = service(['acmeship.example']);
    await svc.isSsoLogin('a@acmeship.example');
    const later = Date.now() + 61_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await svc.isSsoLogin('a@acmeship.example');
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('SsoDomainService failure behaviour (spec 0057 AC 4)', () => {
  it('resolves false instead of throwing when the pool fails', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db down'));
    const svc = new SsoDomainService({ query } as unknown as Pool);
    await expect(svc.isSsoLogin('anna@acmeship.example')).resolves.toBe(false);
  });

  it('keeps serving the last known set when a later load fails', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ domain: 'acmeship.example' }] })
      .mockRejectedValue(new Error('db down'));
    const svc = new SsoDomainService({ query } as unknown as Pool);
    await expect(svc.isSsoLogin('anna@acmeship.example')).resolves.toBe(true);
    const later = Date.now() + 61_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await expect(svc.isSsoLogin('anna@acmeship.example')).resolves.toBe(true);
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('POST /auth/sso-check (spec 0057 AC 5)', () => {
  function controller(sso: boolean): AuthController {
    return new AuthController(
      { get: () => undefined } as unknown as ConfigService,
      {} as unknown as LocalAuthService,
      {} as unknown as OidcService,
      {} as unknown as SessionService,
      {} as unknown as UserApprovalService,
      { isSsoLogin: jest.fn().mockResolvedValue(sso) } as unknown as SsoDomainService,
    );
  }

  it('answers {sso} for a valid body', async () => {
    await expect(
      controller(true).ssoCheck({ body: { username: 'a@acmeship.example' } } as Request),
    ).resolves.toEqual({ sso: true });
    await expect(
      controller(false).ssoCheck({ body: { username: 'captain' } } as Request),
    ).resolves.toEqual({ sso: false });
  });

  it('rejects a malformed body (400) — never an answer about the shape', async () => {
    const bodies = [
      {},
      { username: '' },
      { username: 'a'.repeat(201) },
      { username: 'a@acmeship.example', password: 'x' },
      { username: 42 },
    ];
    for (const body of bodies) {
      await expect(
        controller(true).ssoCheck({ body } as Request),
      ).rejects.toThrow(BadRequestException);
    }
  });
});
