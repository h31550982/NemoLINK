import { SetMetadata } from '@nestjs/common';

/**
 * Authz policies v0 (docs/specs/0008). The full auth module (OIDC, local
 * accounts, RBAC) extends this set; the decorator + boot check + guard are
 * the permanent skeleton.
 *
 * - 'public'  — no app-level auth; only for routes with their own protection
 *               story (VPN-only health, signature-verified SNS webhook,
 *               the login endpoints themselves).
 * - 'api-key' — Authorization: Bearer <NEMOLINK_API_KEY>.
 * - 'session' — session cookie of an active user (spec 0011); the guard
 *               attaches request.user. Role-granular policies extend here.
 * - 'session:admin' — session AND role admin (spec 0012); non-admins get 403.
 * - 'ingest-key' — per-source scoped service credential (spec 0026):
 *               Bearer token resolved against platform.ingest_credential
 *               (sha256 lookup); the guard attaches request.ingest with the
 *               credential's org + source system.
 * - 'session:platform' — session of a nauticAi platform admin (spec 0030;
 *               role 'superadmin'), whether or not they are currently
 *               acting inside a customer org. Guards the platform level:
 *               org list, platform audit, acting-org switching.
 */
export type AuthzPolicy =
  | 'public'
  | 'api-key'
  | 'session'
  | 'session:admin'
  | 'session:platform'
  | 'ingest-key';

export const AUTHZ_KEY = 'nemolink:authz';

/** Every route MUST declare a policy — the app refuses to boot otherwise. */
export const Authz = (policy: AuthzPolicy) => SetMetadata(AUTHZ_KEY, policy);
