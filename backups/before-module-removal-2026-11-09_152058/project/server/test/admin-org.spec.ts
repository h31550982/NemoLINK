/**
 * Spec 0038 — org declarant profile: vendored-spelling storage mapping,
 * merge/clear/prune semantics, validation, diff-audited updates.
 */
import type { PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import {
  AGENT_KEY,
  OrgService,
  agentFromData,
  applyAgentToData,
  agentSchema,
  diffProfile,
  orgUpdateSchema,
} from '../src/admin/org.service';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const FULL_INPUT = agentSchema.parse({
  agentId: 'FI06695798',
  agencyName: 'Acmeship Oy',
  mobile: '+358400468025',
  email: 'operations@acmeship.example',
});

describe('carrier-agent storage mapping (spec 0038 AC 2)', () => {
  it('stores under the vendored NOA spelling', () => {
    const data = applyAgentToData({}, FULL_INPUT);
    expect(data[AGENT_KEY]).toEqual({
      'ram:ID': 'FI06695798',
      'ram:Name': 'Acmeship Oy',
      'ram:DefinedTradeContact': {
        'ram:MobileTelephoneUniversalCommunication': {
          'ram:CompleteNumber': '+358400468025',
        },
        'ram:EmailURIUniversalCommunication': {
          'ram:URIID': 'operations@acmeship.example',
        },
      },
    });
  });

  it('round-trips, merges per field and prunes cleared containers', () => {
    const data = applyAgentToData({}, FULL_INPUT);
    expect(agentFromData(data)).toEqual({
      agentId: 'FI06695798',
      agencyName: 'Acmeship Oy',
      mobile: '+358400468025',
      email: 'operations@acmeship.example',
    });
    // partial: only the mobile changes, everything else survives
    const merged = applyAgentToData(data, agentSchema.parse({ mobile: '+358 40 1' }));
    expect(agentFromData(merged)).toMatchObject({
      agencyName: 'Acmeship Oy',
      mobile: '+358 40 1',
      email: 'operations@acmeship.example',
    });
    // clearing every contact prunes DefinedTradeContact; clearing all leaves {}
    const noContact = applyAgentToData(
      merged,
      agentSchema.parse({ mobile: null, email: null }),
    );
    expect(
      (noContact[AGENT_KEY] as Record<string, unknown>)['ram:DefinedTradeContact'],
    ).toBeUndefined();
    const empty = applyAgentToData(
      noContact,
      agentSchema.parse({ agentId: null, agencyName: null }),
    );
    expect(empty[AGENT_KEY]).toBeUndefined();
  });
});

describe('the postal address (spec 0092: the liable party of the DUE)', () => {
  it('stores under ram:PostalTradeAddress, reads back, and prunes when cleared', () => {
    const data = applyAgentToData({}, agentSchema.parse({ street: 'Satamatie 1', postcode: '26100', city: 'Rauma', countryCode: 'FI' }));
    expect((data['ram:CarrierAgentTradeParty'] as Record<string, unknown>)['ram:PostalTradeAddress']).toEqual({
      'ram:StreetName': 'Satamatie 1',
      'ram:PostcodeCode': '26100',
      'ram:CityName': 'Rauma',
      'ram:CountryID': 'FI',
    });
    expect(agentFromData(data)).toEqual({ street: 'Satamatie 1', postcode: '26100', city: 'Rauma', countryCode: 'FI' });
    const cleared = applyAgentToData(data, agentSchema.parse({ street: null, postcode: null, city: null, countryCode: null }));
    expect(cleared['ram:CarrierAgentTradeParty']).toBeUndefined();
  });

  it('takes the country as two capital letters (ISO 3166)', () => {
    expect(agentSchema.safeParse({ countryCode: 'FI' }).success).toBe(true);
    expect(agentSchema.safeParse({ countryCode: 'Finland' }).success).toBe(false);
  });
});

describe('validation (spec 0038 AC 1)', () => {
  it('phones need the country prefix; emails must be emails; strict keys', () => {
    expect(orgUpdateSchema.safeParse({ agent: { mobile: '0400468025' } }).success).toBe(false);
    expect(orgUpdateSchema.safeParse({ agent: { mobile: '+358400468025' } }).success).toBe(true);
    expect(orgUpdateSchema.safeParse({ agent: { email: 'not-an-email' } }).success).toBe(false);
    expect(orgUpdateSchema.safeParse({ agent: { fax: '+123456' } }).success).toBe(false);
    expect(orgUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(
      orgUpdateSchema.safeParse({ businessId: null, eori: 'FI123456789012' }).success,
    ).toBe(true);
  });
});

describe('org profile update (spec 0038 AC 1 + 3)', () => {
  function makeService(dbRow: Record<string, unknown>) {
    const calls: { sql: string; params: unknown[] | undefined }[] = [];
    const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('FOR UPDATE')) return { rows: [dbRow] };
      if (sql.includes('UPDATE platform.organization')) {
        // echo the update back with the new data payload applied
        const p = params as unknown[];
        return {
          rows: [
            {
              ...dbRow,
              business_id: (p[1] as boolean) ? p[2] : dbRow['business_id'],
              eori: (p[3] as boolean) ? p[4] : dbRow['eori'],
              data: JSON.parse(p[5] as string),
            },
          ],
        };
      }
      return { rows: [dbRow] };
    });
    const client = { query: clientQuery } as unknown as PoolClient;
    const content = jest.fn().mockResolvedValue('audit-1');
    const tenantDb = {
      schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
      withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) =>
        fn(client),
      ),
    } as unknown as TenantDb;
    const service = new OrgService(tenantDb, { content } as unknown as AuditService);
    return { service, calls, content };
  }

  const DB_ROW = {
    id: 'org-1',
    slug: 'acmeship',
    name: 'Acmeship Oy',
    entra_tenant_id: null,
    created: new Date('2026-08-21T10:00:00Z'),
    business_id: null,
    eori: null,
    data: {},
  };

  it('locks, merges, audits the field-level diff on the org chain', async () => {
    const { service, content } = makeService(DB_ROW);
    const after = await service.update(ADMIN, {
      businessId: 'FI06695798',
      agent: { agencyName: 'Acmeship Oy', mobile: '+358400468025' },
    });
    expect(after.businessId).toBe('FI06695798');
    expect(after.agent).toEqual({ agencyName: 'Acmeship Oy', mobile: '+358400468025' });
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin@acmeship.example',
        entityType: 'organization',
        entityId: 'org-1',
        schema: 'org_acmeship',
        data: {
          action: 'profile_updated',
          changes: {
            businessId: { from: null, to: 'FI06695798' },
            'agent.agencyName': { from: null, to: 'Acmeship Oy' },
            'agent.mobile': { from: null, to: '+358400468025' },
          },
        },
      }),
      expect.anything(),
    );
  });

  it('a no-op save records changes: {}', async () => {
    const { service, content } = makeService(DB_ROW);
    await service.update(ADMIN, {});
    expect(content.mock.calls[0][0].data).toEqual({
      action: 'profile_updated',
      changes: {},
    });
  });

  it('diffProfile covers columns and agent fields', () => {
    const base = {
      slug: 'acmeship', name: 'Acmeship Oy', entraTenantId: null,
      created: 'x', businessId: null, eori: null, agent: {},
    };
    expect(
      diffProfile(base, {
        ...base,
        eori: 'FI1',
        agent: { email: 'operations@acmeship.example' },
      }),
    ).toEqual({
      eori: { from: null, to: 'FI1' },
      'agent.email': { from: null, to: 'operations@acmeship.example' },
    });
  });
});
