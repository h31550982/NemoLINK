import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import { AuthzGuard } from '../src/auth/authz.guard';
import { IngestCredentialService } from '../src/ingest/ingest-credential.service';
import type { AuthzPolicy } from '../src/auth/authz.decorator';
import type { SessionService } from '../src/auth/session.service';

const KEY = 'k'.repeat(64);

function guardWith(policy: AuthzPolicy | undefined, configuredKey?: string): AuthzGuard {
  const reflector = {
    getAllAndOverride: () => policy,
  } as unknown as Reflector;
  const config = {
    get: (name: string) => (name === 'NEMOLINK_API_KEY' ? configuredKey : undefined),
  } as unknown as ConfigService;
  const sessions = { resolve: async () => null } as unknown as SessionService;
  const ingest = { resolve: async () => null } as unknown as IngestCredentialService;
  return new AuthzGuard(reflector, config, sessions, ingest);
}

function contextWithAuth(header?: string): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === 'authorization' ? header : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthzGuard (spec 0008 AC 2)', () => {
  it("allows 'public' routes through", async () => {
    await expect(guardWith('public').canActivate(contextWithAuth())).resolves.toBe(true);
  });

  it('denies undeclared routes (defense in depth behind the boot check)', async () => {
    await expect(guardWith(undefined).canActivate(contextWithAuth())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('answers 503 when the api key is not configured', async () => {
    await expect(
      guardWith('api-key', undefined).canActivate(contextWithAuth(`Bearer ${KEY}`)),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects a missing Authorization header', async () => {
    await expect(
      guardWith('api-key', KEY).canActivate(contextWithAuth()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a wrong key and a non-Bearer scheme', async () => {
    const guard = guardWith('api-key', KEY);
    await expect(guard.canActivate(contextWithAuth('Bearer nope'))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextWithAuth(`Basic ${KEY}`))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the exact configured key', async () => {
    await expect(
      guardWith('api-key', KEY).canActivate(contextWithAuth(`Bearer ${KEY}`)),
    ).resolves.toBe(true);
  });
});
