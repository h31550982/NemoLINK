/**
 * Spec 0042 — port picker data: full FI list + the org's ten most-used
 * ports, derived per-tenant from its own port_call rows.
 */

import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PortCallService } from '../src/canonical/port-call.service';
import type { AuditService } from '../src/audit/audit.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import type { SessionUser } from '../src/auth/session.service';

const ADMIN: SessionUser = {
  id: 'u1',
  username: 'admin@acmeship.example',
  displayName: 'A',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

function makeService(rowsBySql: (sql: string) => { rows: unknown[] }) {
  const query = jest.fn(async (sql: string) => rowsBySql(sql));
  const client = { query } as unknown as PoolClient;
  const tenantDb = {
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as TenantDb;
  const service = new PortCallService(tenantDb, {} as AuditService);
  return { service, query, tenantDb };
}

describe('port picker data (spec 0042 AC 1)', () => {
  it('returns frequent + full FI list, both FI-scoped, frequent capped at 10', async () => {
    const { service, query, tenantDb } = makeService((sql) => {
      if (sql.includes('GROUP BY pc.port_locode')) {
        return { rows: [{ locode: 'FIRAU', name: 'Rauma' }] };
      }
      return { rows: [{ locode: 'FIHEL', name: 'Helsinki' }, { locode: 'FIRAU', name: 'Rauma' }] };
    });

    const out = await service.portOptions(ADMIN);
    expect(out.frequent).toEqual([{ locode: 'FIRAU', name: 'Rauma' }]);
    expect(out.ports).toHaveLength(2);
    expect(tenantDb.withOrg).toHaveBeenCalledWith('acmeship', expect.any(Function));

    const frequentSql = (query.mock.calls[0] as string[])[0];
    expect(frequentSql).toContain(`pc.port_locode LIKE 'FI%'`);
    expect(frequentSql).toContain('ORDER BY count(*) DESC');
    expect(frequentSql).toContain('LIMIT 10');
    const portsSql = (query.mock.calls[1] as string[])[0];
    expect(portsSql).toContain(`locode LIKE 'FI%'`);
    expect(portsSql).toContain('platform.location');
    // Spec 0080: NEMO ports only — a hub port area or ISPS facility
    expect(portsSql).toContain(`data ? 'portAreas' OR data ? 'portFacilityCodes'`);
  });

  it('serves captains (spec 0045 PEC picker); rejects an unswitched superadmin', async () => {
    const { service } = makeService(() => ({ rows: [] }));
    await expect(service.portOptions({ ...ADMIN, role: 'captain' })).resolves.toEqual({
      frequent: [],
      ports: [],
    });
    await expect(
      service.portOptions({ ...ADMIN, role: 'superadmin' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
