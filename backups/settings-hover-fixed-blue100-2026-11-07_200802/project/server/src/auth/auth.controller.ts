/**
 * Auth endpoints (docs/specs/0011). Local login + Entra OIDC + session
 * lifecycle. Responses never distinguish unknown user / wrong password /
 * locked (no oracle); OIDC errors redirect to the SPA with a generic flag.
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Authz } from './authz.decorator';
import { parseCookies, serializeCookie } from './cookies';
import { LocalAuthService } from './local-auth.service';
import { OidcService, OidcTransient } from './oidc.service';
import { normalizePec, pecInfoSchema } from './pec';
import { SESSION_COOKIE, SessionService, SessionUser } from './session.service';
import { SsoDomainService } from './sso-domain.service';
import { UserApprovalService } from './user-approval.service';

const OIDC_COOKIE = 'nemolink_oidc';

const loginSchema = z
  .object({ username: z.string().min(1).max(200), password: z.string().min(1).max(500) })
  .strict();

// Home-realm discovery (spec 0057): the username as typed, nothing else
const ssoCheckSchema = z.object({ username: z.string().min(1).max(200) }).strict();

// Structured PEC (spec 0045): certificate details, {none: true}, or null
const pecBodySchema = z.object({ pec: pecInfoSchema.nullable() }).strict();

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly localAuth: LocalAuthService,
    private readonly oidc: OidcService,
    private readonly sessions: SessionService,
    private readonly approval: UserApprovalService,
    private readonly ssoDomains: SsoDomainService,
  ) {}

  private get secureCookies(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private setSession(res: Response, token: string): void {
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, token, {
        maxAge: this.sessions.ttlSeconds,
        secure: this.secureCookies,
      }),
    );
  }

  @Post('login')
  @Authz('public')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestException('username and password required');
    }
    const { token, user } = await this.localAuth.login(
      parsed.data.username,
      parsed.data.password,
    );
    this.setSession(res, token);
    return { user };
  }

  /**
   * "Does this address sign in with SSO?" (spec 0057) — a DOMAIN answer, so
   * no user oracle: the caller must already know the domain, and an unknown
   * one is indistinguishable from a domain with no users.
   */
  @Post('sso-check')
  @Authz('public')
  @HttpCode(200)
  async ssoCheck(@Req() req: Request): Promise<{ sso: boolean }> {
    const parsed = ssoCheckSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestException('username required');
    return { sso: await this.ssoDomains.isSsoLogin(parsed.data.username) };
  }

  @Post('logout')
  @Authz('session')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.sessions.destroy(token);
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: this.secureCookies }),
    );
    return { ok: true };
  }

  @Get('me')
  @Authz('session')
  me(@Req() req: Request): { user: SessionUser } {
    // populated by the session policy in AuthzGuard
    return { user: (req as Request & { user: SessionUser }).user };
  }

  /** A captain's own PEC (specs 0043/0045) — asked on first login, header-visible. */
  @Post('me/pec')
  @Authz('session')
  @HttpCode(200)
  async setPec(@Req() req: Request): Promise<{ user: SessionUser }> {
    const parsed = pecBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid PEC',
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const pec = parsed.data.pec === null ? null : normalizePec(parsed.data.pec);
    const user = (req as Request & { user: SessionUser }).user;
    await this.approval.setOwnPec(user, pec);
    return { user: { ...user, pec } };
  }

  @Get('oidc/start')
  @Authz('public')
  async oidcStart(@Res() res: Response): Promise<void> {
    if (!this.oidc.enabled) {
      throw new ServiceUnavailableException('SSO not configured');
    }
    const { url, transient } = await this.oidc.start();
    res.setHeader(
      'Set-Cookie',
      serializeCookie(
        OIDC_COOKIE,
        Buffer.from(JSON.stringify(transient)).toString('base64url'),
        { maxAge: 600, secure: this.secureCookies },
      ),
    );
    res.redirect(url);
  }

  @Get('oidc/callback')
  @Authz('public')
  async oidcCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.oidc.enabled) {
      throw new ServiceUnavailableException('SSO not configured');
    }
    let transient: OidcTransient | undefined;
    try {
      const raw = parseCookies(req.headers.cookie)[OIDC_COOKIE];
      if (raw) {
        transient = JSON.parse(Buffer.from(raw, 'base64url').toString()) as OidcTransient;
      }
    } catch {
      transient = undefined;
    }
    const clearTransient = serializeCookie(OIDC_COOKIE, '', {
      maxAge: 0,
      secure: this.secureCookies,
    });
    if (!transient?.state || !transient.nonce || !transient.verifier) {
      res.setHeader('Set-Cookie', clearTransient);
      res.redirect('/?login=failed');
      return;
    }
    try {
      const callbackUrl = new URL(
        req.originalUrl,
        this.oidc.redirectUri(),
      );
      const result = await this.oidc.callback(callbackUrl, transient);
      if (result.outcome === 'pending') {
        // Recorded + admins notified (spec 0012) — SPA shows the
        // "contact your admin" toast on this flag
        res.setHeader('Set-Cookie', clearTransient);
        res.redirect('/?login=pending');
        return;
      }
      if (result.outcome === 'revoked') {
        // Validated token, rejected account — their own status, no oracle
        res.setHeader('Set-Cookie', clearTransient);
        res.redirect('/?login=revoked');
        return;
      }
      res.setHeader('Set-Cookie', [
        clearTransient,
        serializeCookie(SESSION_COOKIE, result.token, {
          maxAge: this.sessions.ttlSeconds,
          secure: this.secureCookies,
        }),
      ]);
      res.redirect('/');
    } catch {
      // Reason already audited/logged in OidcService — the browser gets no detail
      res.setHeader('Set-Cookie', clearTransient);
      res.redirect('/?login=failed');
    }
  }
}
