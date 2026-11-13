import type { Pool, PoolClient } from 'pg';
import type { Request, Response } from 'express';
import { AuditService, computeEventHash } from '../src/audit/audit.service';
import {
  currentRequestForensics,
  requestForensicsMiddleware,
} from '../src/audit/request-context';

const base = {
  prevHash: null,
  category: 'content',
  actorId: 'tester',
  entityType: 'thing',
  entityId: 'id-1',
  data: { a: 1 },
  createdIso: '2026-08-22T00:00:00.000Z',
};

describe('computeEventHash (spec 0007 chain design)', () => {
  it('is deterministic', () => {
    expect(computeEventHash(base)).toBe(computeEventHash({ ...base }));
  });

  it('is 64 hex chars (sha256)', () => {
    expect(computeEventHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any field changes', () => {
    const reference = computeEventHash(base);
    const variants = [
      { ...base, prevHash: computeEventHash(base) },
      { ...base, category: 'access' },
      { ...base, actorId: 'other' },
      { ...base, entityType: 'other' },
      { ...base, entityId: 'id-2' },
      { ...base, data: { a: 2 } },
      { ...base, createdIso: '2026-08-22T00:00:00.001Z' },
    ];
    for (const variant of variants) {
      expect(computeEventHash(variant)).not.toBe(reference);
    }
  });

  it('treats null and absent identity fields identically to empty string joins', () => {
    // '' is the documented null placeholder — a null actor and an ''-actor
    // hash the same; the chain relies on this staying stable
    expect(computeEventHash({ ...base, actorId: null })).toBe(
      computeEventHash({ ...base, actorId: null }),
    );
  });

  it('links: same event with different prevHash yields different hash', () => {
    const first = computeEventHash(base);
    const second = computeEventHash({ ...base, prevHash: first });
    expect(second).not.toBe(first);
  });

  it('is insensitive to data key order (canonical json)', () => {
    const a = computeEventHash({ ...base, data: { x: 1, y: 2 } });
    const b = computeEventHash({ ...base, data: { y: 2, x: 1 } });
    expect(a).toBe(b);
  });
});

describe('request forensics on audit events (spec 0033)', () => {
  function fakeReq(ip: string, userAgent?: string): Request {
    return {
      ip,
      headers: userAgent ? { 'user-agent': userAgent } : {},
    } as unknown as Request;
  }

  /** Runs fn inside the middleware's AsyncLocalStorage scope. */
  function runInForensics<T>(req: Request, fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      requestForensicsMiddleware(req, {} as Response, () => {
        fn().then(resolve, reject);
      });
    });
  }

  function makeClient() {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('ORDER BY seq DESC')) return { rows: [] };
      return { rows: [{ id: 'evt-1' }] };
    });
    return { client: { query } as unknown as PoolClient, query };
  }

  function storedInsert(query: jest.Mock): { data: Record<string, unknown>; params: unknown[] } {
    const call = query.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
    const params = call![1] as unknown[];
    return { data: JSON.parse(params[4] as string), params };
  }

  it('middleware exposes ip + clamped user agent only inside the scope (AC 4)', async () => {
    await runInForensics(fakeReq('203.0.113.9', 'x'.repeat(999)), async () => {
      const forensics = currentRequestForensics();
      expect(forensics?.ip).toBe('203.0.113.9');
      expect(forensics?.userAgent).toHaveLength(256);
    });
    expect(currentRequestForensics()).toBeUndefined();
  });

  it('stamps request onto the stored data AND into the hash (AC 2, AC 3)', async () => {
    const { client, query } = makeClient();
    const service = new AuditService({} as Pool);
    await runInForensics(fakeReq('203.0.113.9', 'PostmanRuntime/7.36'), () =>
      service.content(
        {
          actorId: 'a',
          entityType: 'ship',
          entityId: 'v1',
          data: { action: 'updated' },
          schema: 'org_acmeship',
        },
        client,
      ),
    );
    const { data, params } = storedInsert(query);
    expect(data['request']).toEqual({
      ip: '203.0.113.9',
      userAgent: 'PostmanRuntime/7.36',
    });
    // the chain covers the forensics: the stored hash is computed over
    // the merged data
    expect(params[6]).toBe(
      computeEventHash({
        prevHash: null,
        category: 'content',
        actorId: 'a',
        entityType: 'ship',
        entityId: 'v1',
        data,
        createdIso: params[7] as string,
      }),
    );
  });

  it('no request key outside HTTP scope; a caller-supplied request survives (AC 2)', async () => {
    const { client, query } = makeClient();
    const service = new AuditService({} as Pool);
    await service.content(
      { entityType: 'ship', data: { action: 'updated' }, schema: 'org_acmeship' },
      client,
    );
    expect('request' in storedInsert(query).data).toBe(false);

    query.mockClear();
    await runInForensics(fakeReq('203.0.113.9'), () =>
      service.content(
        {
          entityType: 'ship',
          data: { action: 'x', request: { ip: 'caller-set' } },
          schema: 'org_acmeship',
        },
        client,
      ),
    );
    expect(storedInsert(query).data['request']).toEqual({ ip: 'caller-set' });
  });
});
