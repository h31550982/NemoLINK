import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  IngestContext,
  IngestCredentialService,
} from '../ingest/ingest-credential.service';
import { AUTHZ_KEY, AuthzPolicy } from './authz.decorator';
import { parseCookies } from './cookies';
import { SESSION_COOKIE, SessionService, SessionUser } from './session.service';

/**
 * Global guard (invariant 2): enforces the route's declared @Authz policy on
 * every request. Routes without a declaration are denied here as defense in
 * depth — the boot check in AuthModule should have prevented startup already.
 * 401 responses never hint which check failed; the key is never logged.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    private readonly ingestCredentials: IngestCredentialService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AuthzPolicy | undefined>(
      AUTHZ_KEY,
      [context.getHandler(), context.getClass()],
    );
    switch (policy) {
      case 'public':
        return true;
      case 'api-key':
        return this.checkApiKey(context);
      case 'session':
        return this.checkSession(context);
      case 'session:admin': {
        await this.checkSession(context);
        const { user } = context
          .switchToHttp()
          .getRequest<Request & { user?: SessionUser }>();
        if (user?.role !== 'admin') throw new ForbiddenException();
        return true;
      }
      case 'session:platform': {
        await this.checkSession(context);
        const { user } = context
          .switchToHttp()
          .getRequest<Request & { user?: SessionUser }>();
        if (!user?.platformAdmin) throw new ForbiddenException();
        return true;
      }
      case 'ingest-key':
        return this.checkIngestKey(context);
      default:
        // Undeclared — must never happen past the boot check
        throw new UnauthorizedException();
    }
  }

  private async checkSession(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const user = token ? await this.sessions.resolve(token) : null;
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }

  /** Per-source service credential (spec 0026) — attaches request.ingest. */
  private async checkIngestKey(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { ingest?: IngestContext }>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const resolved = await this.ingestCredentials.resolve(token);
    if (!resolved) throw new UnauthorizedException();
    request.ingest = resolved;
    return true;
  }

  private checkApiKey(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('NEMOLINK_API_KEY');
    if (!configured) {
      throw new ServiceUnavailableException('API access not configured');
    }
    const header = context
      .switchToHttp()
      .getRequest<Request>()
      .header('authorization');
    const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(presented);
    const b = Buffer.from(configured);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
