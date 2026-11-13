/**
 * Per-org NEMO credentials (docs/specs/0059) — the customer's own client_id /
 * client_secret, encrypted at rest, selected per call.
 *
 * The organizationBusinessId header is the Y-tunnus of the organisation THE
 * KEY BELONGS TO — which is the key's own client id (Fintraffic's
 * Asiakastunniste), so nothing extra is stored. Not the org's own
 * platform.organization.business_id: fleetco testing with Fintraffic's
 * shared staging key acts as the test organisation 1471406-3, and the NSD
 * ship search answered 403 to a valid token whose header named another
 * organisation (host, 2026-09-25; spec 0059 amendment). Declarant API reads
 * had ignored the value (spec 0062 F8). Spec 0059 first read the header as
 * the Agent identification number; that value stays what the carrier-agent
 * block puts on the declaration (spec 0038).
 *
 * Reads go straight to the platform tables (the IngestCredentialService
 * precedent, spec 0026): no tenant data is touched, and the worker resolves
 * credentials with no session in hand. Admin writes run inside TenantDb.withOrg
 * so the audit event commits with the change (invariant 5).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { SessionUser } from '../auth/session.service';
import { PG_POOL } from '../db/db.module';
import { TenantDb } from '../tenancy/tenant-db';
import { CredentialCrypto } from './credential-crypto';

/**
 * The EORI of the organisation a NEMO key belongs to (spec 0070 amendment):
 * Fintraffic's client id is the organisation's Y-tunnus, and a Finnish EORI
 * is 'FI' + Y-tunnus (spec 0062 F8: NEMO's own MAI carries FI1471406-3 for
 * client 1471406-3). Null when the client id is not a Y-tunnus — the
 * caller then uses the org's own EORI from its declarant details.
 */
export function eoriOfClientId(clientId: string | null | undefined): string | null {
  const id = (clientId ?? '').trim();
  return /^\d{7}-\d$/.test(id) ? `FI${id}` : null;
}

/** stg | prd — 'mock' never reaches the vault (spec 0059). */
export type StoredTarget = 'stg' | 'prd';
export const STORED_TARGETS: readonly StoredTarget[] = ['stg', 'prd'] as const;

export const credentialSetSchema = z
  .object({
    target: z.enum(['stg', 'prd']),
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(500),
    label: z.string().min(1).max(100).nullable().optional(),
  })
  .strict();

export const credentialRemoveSchema = z
  .object({ target: z.enum(['stg', 'prd']) })
  .strict();

export type CredentialSet = z.infer<typeof credentialSetSchema>;

/** What nemo-client needs to sign one call as one org. */
export interface ResolvedCredential {
  clientId: string;
  clientSecret: string;
  /**
   * The organizationBusinessId header: the Y-tunnus of the organisation the
   * key belongs to = the client id (spec 0059 amendment 2026-09-25).
   */
  businessId: string;
}

/** Status for the admin UI — never carries the secret, by construction. */
export interface CredentialStatus {
  target: StoredTarget;
  configured: boolean;
  label: string | null;
  keyId: string | null;
  author: string | null;
  updated: string | null;
}

export class NemoCredentialMissingError extends Error {
  constructor(orgSlug: string, target: string) {
    super(
      `No active NEMO credential for org '${orgSlug}' on target '${target}' — ` +
        'an admin sets it on the Organization page',
    );
    this.name = 'NemoCredentialMissingError';
  }
}

interface SecretBlob {
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class NemoCredentialService {
  private readonly logger = new Logger(NemoCredentialService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly crypto: CredentialCrypto,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /**
   * The credential nemo-client signs with. Fails closed and distinctly: a
   * missing key and an unconfigured vault are two different problems with
   * two different fixes. The header identity comes from the key itself.
   */
  async resolve(orgSlug: string, target: StoredTarget): Promise<ResolvedCredential> {
    const result = await this.pool.query<{
      ciphertext: Buffer | null;
      key_id: string | null;
    }>(
      `SELECT c.ciphertext, c.key_id
         FROM platform.organization o
         LEFT JOIN platform.nemo_credential c
           ON c.org_id = o.id AND c.nemo_target = $2 AND c.is_active
        WHERE o.slug = $1 AND o.is_active`,
      [orgSlug, target],
    );
    const row = result.rows[0];
    if (!row) throw new NemoCredentialMissingError(orgSlug, target);
    if (!row.ciphertext || !row.key_id) {
      throw new NemoCredentialMissingError(orgSlug, target);
    }
    const secret = JSON.parse(
      this.crypto.decrypt(row.ciphertext, row.key_id),
    ) as SecretBlob;
    return {
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
      // The key's own organisation — a shared staging key identifies itself.
      businessId: secret.clientId,
    };
  }

  /** Both targets, for the Organization page. Never reads the ciphertext. */
  async status(orgSlug: string): Promise<CredentialStatus[]> {
    const result = await this.pool.query<{
      nemo_target: StoredTarget;
      label: string | null;
      key_id: string;
      author: string | null;
      updated: Date;
    }>(
      `SELECT c.nemo_target, c.label, c.key_id, c.author, c.updated
         FROM platform.nemo_credential c
         JOIN platform.organization o ON o.id = c.org_id AND o.is_active
        WHERE o.slug = $1 AND c.is_active`,
      [orgSlug],
    );
    const bySlug = new Map(result.rows.map((r) => [r.nemo_target, r]));
    return STORED_TARGETS.map((target) => {
      const row = bySlug.get(target);
      return {
        target,
        configured: !!row,
        label: row?.label ?? null,
        keyId: row?.key_id ?? null,
        author: row?.author ?? null,
        updated: row?.updated.toISOString() ?? null,
      };
    });
  }

  /**
   * Rotation is deactivate + insert, never an update in place: the previous
   * key stays readable in the row history and in the audit chain. The partial
   * unique index makes "exactly one active" a database fact, not a convention.
   */
  async set(user: SessionUser, input: CredentialSet): Promise<CredentialStatus[]> {
    const { ciphertext, keyId } = this.crypto.encrypt(
      JSON.stringify({ clientId: input.clientId, clientSecret: input.clientSecret }),
    );
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const org = await client.query<{ id: string }>(
        `SELECT id FROM platform.organization WHERE slug = $1 AND is_active FOR UPDATE`,
        [user.orgSlug],
      );
      const orgId = org.rows[0]?.id;
      if (!orgId) throw new NemoCredentialMissingError(user.orgSlug, input.target);

      const replaced = await client.query(
        `UPDATE platform.nemo_credential
            SET is_active = false, updated = now()
          WHERE org_id = $1 AND nemo_target = $2 AND is_active`,
        [orgId, input.target],
      );
      await client.query(
        `INSERT INTO platform.nemo_credential
           (org_id, nemo_target, label, ciphertext, key_id, author)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, input.target, input.label ?? null, ciphertext, keyId, user.username],
      );
      // Target, label and key id only — never the client id, never the secret,
      // not even truncated (spec 0059 AC 4).
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'nemo_credential',
          entityId: orgId,
          data: {
            action: (replaced.rowCount ?? 0) > 0 ? 'credential_rotated' : 'credential_set',
            target: input.target,
            label: input.label ?? null,
            keyId,
          },
          schema,
        },
        client,
      );
    });
    this.logger.log(
      `NEMO credential ${input.target} set for org ${user.orgSlug} by ${user.username}`,
    );
    return this.status(user.orgSlug);
  }

  async remove(user: SessionUser, target: StoredTarget): Promise<CredentialStatus[]> {
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const org = await client.query<{ id: string }>(
        `SELECT id FROM platform.organization WHERE slug = $1 AND is_active FOR UPDATE`,
        [user.orgSlug],
      );
      const orgId = org.rows[0]?.id;
      if (!orgId) return;
      const removed = await client.query(
        `UPDATE platform.nemo_credential
            SET is_active = false, updated = now()
          WHERE org_id = $1 AND nemo_target = $2 AND is_active`,
        [orgId, target],
      );
      if ((removed.rowCount ?? 0) === 0) return;
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'nemo_credential',
          entityId: orgId,
          data: { action: 'credential_removed', target },
          schema,
        },
        client,
      );
    });
    return this.status(user.orgSlug);
  }
}
