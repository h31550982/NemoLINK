import {
  Injectable,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, ModulesContainer, Reflector } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { IngestCredentialModule } from '../ingest/ingest-credential.module';
import { NotifyModule } from '../notify/notify.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthController } from './auth.controller';
import { AUTHZ_KEY } from './authz.decorator';
import { AuthzGuard } from './authz.guard';
import { LocalAuthService } from './local-auth.service';
import { OidcService } from './oidc.service';
import { SessionService } from './session.service';
import { SsoDomainService } from './sso-domain.service';
import { UserApprovalService } from './user-approval.service';
import { UsersController } from './users.controller';

/**
 * Boot-time enforcement of invariant 2 (docs/specs/0008): every registered
 * route handler must carry an @Authz declaration (method or class level) —
 * otherwise the application throws and never starts serving.
 */
@Injectable()
export class AuthzBootCheck implements OnApplicationBootstrap {
  constructor(
    private readonly modules: ModulesContainer,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const unguarded: string[] = [];
    for (const module of this.modules.values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype;
        if (!controller) continue;
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          if (name === 'constructor') continue;
          // Descriptor access only: reading prototype[name] would evaluate
          // accessor properties (getters) with an unbound `this`
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
          const handler = descriptor?.value;
          if (typeof handler !== 'function') continue;
          const isRoute =
            Reflect.getMetadata(PATH_METADATA, handler) !== undefined &&
            Reflect.getMetadata(METHOD_METADATA, handler) !== undefined;
          if (!isRoute) continue;
          const policy = this.reflector.getAllAndOverride<string | undefined>(
            AUTHZ_KEY,
            [handler as (...args: unknown[]) => unknown, controller],
          );
          if (policy === undefined) {
            unguarded.push(`${controller.name}.${name}`);
          }
        }
      }
    }
    if (unguarded.length > 0) {
      throw new Error(
        `Unguarded routes (missing @Authz — invariant 2): ${unguarded.join(', ')}`,
      );
    }
  }
}

@Module({
  // TenancyModule: the captain↔ship binding validates the ship inside the
  // org schema (spec 0049). Tenancy never imports Auth back — no cycle.
  imports: [AuditModule, IngestCredentialModule, NotifyModule, TenancyModule],
  controllers: [AuthController, UsersController],
  providers: [
    AuthzBootCheck,
    SessionService,
    LocalAuthService,
    OidcService,
    UserApprovalService,
    SsoDomainService,
    { provide: APP_GUARD, useClass: AuthzGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
