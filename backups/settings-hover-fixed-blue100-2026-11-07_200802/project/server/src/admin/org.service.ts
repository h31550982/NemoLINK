/**
 * Org declarant profile (docs/specs/0038): the static customer-level data
 * every declaration pre-fills — business id / EORI (existing registry
 * columns) and the carrier-agent block, stored in platform.organization.data
 * under the vendored NOA spelling (invariant 10, ADR 0004 pattern).
 * Admin-editable, own org only; every change audits on the ORG chain with a
 * field-level diff (spec 0032) so customer admins see it in their log.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { SessionUser } from '../auth/session.service';
import { TenantDb } from '../tenancy/tenant-db';

export const AGENT_KEY = 'ram:CarrierAgentTradeParty';
const CONTACT_KEY = 'ram:DefinedTradeContact';

/** wire key -> [container under DefinedTradeContact, leaf key]. */
const CONTACT_FIELDS = {
  mobile: ['ram:MobileTelephoneUniversalCommunication', 'ram:CompleteNumber'],
  landline: ['ram:DirectTelephoneUniversalCommunication', 'ram:CompleteNumber'],
  email: ['ram:EmailURIUniversalCommunication', 'ram:URIID'],
} as const;

/**
 * The agency's postal address (spec 0092): the DUE's liable party address
 * (DE-077-15/18/19/20), kept under the agent in the vendored spelling.
 * wire key -> leaf under ram:PostalTradeAddress.
 */
const ADDRESS_KEY = 'ram:PostalTradeAddress';
const ADDRESS_FIELDS = {
  street: 'ram:StreetName',
  postcode: 'ram:PostcodeCode',
  city: 'ram:CityName',
  countryCode: 'ram:CountryID',
} as const;

const str = z.string().min(1).max(200);
// The sheet says "specify country prefix" — made a rule.
const phone = z
  .string()
  .regex(/^\+[0-9][0-9 -]{4,24}$/, 'Phone numbers start with the country prefix, e.g. +358…');

export const agentSchema = z
  .object({
    agentId: z.string().min(1).max(50).nullable().optional(),
    agencyName: str.nullable().optional(),
    mobile: phone.nullable().optional(),
    landline: phone.nullable().optional(),
    email: z.string().email().max(200).nullable().optional(),
    street: str.nullable().optional(),
    postcode: z.string().min(1).max(20).nullable().optional(),
    city: str.nullable().optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/, 'Two letters, ISO 3166 (FI)').nullable().optional(),
  })
  .strict();

export const orgUpdateSchema = z
  .object({
    businessId: z.string().min(1).max(50).nullable().optional(),
    eori: z.string().min(1).max(50).nullable().optional(),
    agent: agentSchema.optional(),
  })
  .strict();

export type OrgUpdate = z.infer<typeof orgUpdateSchema>;

export interface OrgAgent {
  agentId?: string;
  agencyName?: string;
  mobile?: string;
  landline?: string;
  email?: string;
  street?: string;
  postcode?: string;
  city?: string;
  countryCode?: string;
}

export interface OrgProfile {
  slug: string;
  name: string;
  entraTenantId: string | null;
  created: string;
  businessId: string | null;
  eori: string | null;
  agent: OrgAgent;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** org.data -> the camelCase wire block; only set fields. */
export function agentFromData(data: Record<string, unknown>): OrgAgent {
  const party = asObject(data?.[AGENT_KEY]);
  const contact = asObject(party[CONTACT_KEY]);
  const out: OrgAgent = {};
  if (typeof party['ram:ID'] === 'string') out.agentId = party['ram:ID'];
  if (typeof party['ram:Name'] === 'string') out.agencyName = party['ram:Name'];
  for (const [wire, [container, leaf]] of Object.entries(CONTACT_FIELDS)) {
    const value = asObject(contact[container])[leaf];
    if (typeof value === 'string') {
      out[wire as keyof typeof CONTACT_FIELDS] = value;
    }
  }
  const address = asObject(party[ADDRESS_KEY]);
  for (const [wire, leaf] of Object.entries(ADDRESS_FIELDS)) {
    const value = address[leaf];
    if (typeof value === 'string') out[wire as keyof typeof ADDRESS_FIELDS] = value;
  }
  return out;
}

/**
 * Merge one agent input into org.data (new object, never mutates):
 * present = set, null = clear, absent = untouched; empty nested objects
 * are pruned so a fully cleared block leaves no residue.
 */
export function applyAgentToData(
  data: Record<string, unknown>,
  input: z.infer<typeof agentSchema>,
): Record<string, unknown> {
  const out = { ...data };
  const party = { ...asObject(out[AGENT_KEY]) };
  const contact = { ...asObject(party[CONTACT_KEY]) };

  if ('agentId' in input) {
    if (input.agentId == null) delete party['ram:ID'];
    else party['ram:ID'] = input.agentId;
  }
  if ('agencyName' in input) {
    if (input.agencyName == null) delete party['ram:Name'];
    else party['ram:Name'] = input.agencyName;
  }
  for (const [wire, [container, leaf]] of Object.entries(CONTACT_FIELDS)) {
    if (!(wire in input)) continue;
    const value = (input as Record<string, unknown>)[wire];
    if (value == null) delete contact[container];
    else contact[container] = { [leaf]: value };
  }

  const address = { ...asObject(party[ADDRESS_KEY]) };
  for (const [wire, leaf] of Object.entries(ADDRESS_FIELDS)) {
    if (!(wire in input)) continue;
    const value = (input as Record<string, unknown>)[wire];
    if (value == null) delete address[leaf];
    else address[leaf] = value;
  }
  if (Object.keys(contact).length > 0) party[CONTACT_KEY] = contact;
  else delete party[CONTACT_KEY];
  if (Object.keys(address).length > 0) party[ADDRESS_KEY] = address;
  else delete party[ADDRESS_KEY];
  if (Object.keys(party).length > 0) out[AGENT_KEY] = party;
  else delete out[AGENT_KEY];
  return out;
}

/** Field-level old→new diff for the audit event (spec 0032 pattern). */
export function diffProfile(
  before: OrgProfile,
  after: OrgProfile,
): Record<string, { from: string | null; to: string | null }> {
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const key of ['businessId', 'eori'] as const) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  for (const key of ['agentId', 'agencyName', 'mobile', 'landline', 'email', 'street', 'postcode', 'city', 'countryCode'] as const) {
    const from = before.agent[key] ?? null;
    const to = after.agent[key] ?? null;
    if (from !== to) changes[`agent.${key}`] = { from, to };
  }
  return changes;
}

interface OrgDbRow {
  id: string;
  slug: string;
  name: string;
  entra_tenant_id: string | null;
  created: Date;
  business_id: string | null;
  eori: string | null;
  data: Record<string, unknown>;
}

const ROW_SQL = `id, slug, name, auth_config->>'entraTenantId' AS entra_tenant_id,
                 created, business_id, eori, data`;

function toProfile(row: OrgDbRow): OrgProfile {
  return {
    slug: row.slug,
    name: row.name,
    entraTenantId: row.entra_tenant_id,
    created: row.created.toISOString(),
    businessId: row.business_id,
    eori: row.eori,
    agent: agentFromData(row.data ?? {}),
  };
}

@Injectable()
export class OrgService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async profile(user: SessionUser): Promise<OrgProfile> {
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const result = await client.query<OrgDbRow>(
        `SELECT ${ROW_SQL} FROM platform.organization
          WHERE slug = $1 AND is_active`,
        [user.orgSlug],
      );
      if (!result.rows[0]) throw new NotFoundException();
      return toProfile(result.rows[0]);
    });
  }

  async update(user: SessionUser, input: OrgUpdate): Promise<OrgProfile> {
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const locked = await client.query<OrgDbRow>(
        `SELECT ${ROW_SQL} FROM platform.organization
          WHERE slug = $1 AND is_active FOR UPDATE`,
        [user.orgSlug],
      );
      if (!locked.rows[0]) throw new NotFoundException();
      const before = toProfile(locked.rows[0]);
      const newData = input.agent
        ? applyAgentToData(locked.rows[0].data ?? {}, input.agent)
        : (locked.rows[0].data ?? {});

      const result = await client.query<OrgDbRow>(
        `UPDATE platform.organization SET
           business_id = CASE WHEN $2::boolean THEN $3 ELSE business_id END,
           eori        = CASE WHEN $4::boolean THEN $5 ELSE eori END,
           data        = $6::jsonb,
           updated     = now()
         WHERE id = $1
         RETURNING ${ROW_SQL}`,
        [
          locked.rows[0].id,
          'businessId' in input,
          input.businessId ?? null,
          'eori' in input,
          input.eori ?? null,
          JSON.stringify(newData),
        ],
      );
      const after = toProfile(result.rows[0]!);
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'organization',
          entityId: locked.rows[0].id,
          data: { action: 'profile_updated', changes: diffProfile(before, after) },
          schema,
        },
        client,
      );
      return after;
    });
  }
}
