/**
 * nemo-client against the live contract (docs/specs/0062 AC 1–5, 7). No
 * network: global fetch is stubbed and every call is inspected on the way out.
 */
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../src/audit/audit.service';
import type { MigValidator } from '../src/nemo-client/mig-validator';
import type { NemoCredentialService } from '../src/nemo-client/nemo-credential.service';
import {
  NemoClientService,
  NemoUsageError,
  normalizePortCallStatus,
  type PortCallListWindow,
  type PortCallRequestBody,
} from '../src/nemo-client/nemo-client.service';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeClient(env: Record<string, string> = {}) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const migValidator = { validate: jest.fn(() => []) } as unknown as MigValidator;
  const content = jest.fn().mockResolvedValue('audit-1');
  const audit = { content } as unknown as AuditService;
  const resolve = jest.fn().mockResolvedValue({
    clientId: 'client',
    clientSecret: 'secret',
    businessId: '7654321-0',
  });
  const credentials = { resolve } as unknown as NemoCredentialService;
  const calls: Captured[] = [];
  const responses: Array<() => unknown> = [];
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    if (url.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 300 }), {
        status: 200,
      });
    }
    const custom = responses.shift();
    return new Response(JSON.stringify(custom ? custom() : { ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const service = new NemoClientService(config, migValidator, audit, credentials);
  return { service, calls, content, resolve, responses };
}

describe('nemo-client live contract (spec 0062)', () => {
  it('AC1: the formalityData part is typed application/json', async () => {
    const { service, calls } = makeClient();
    await service.createFormality('mock', 'FI20260924-029-6', 'SHP', { probe: true });
    const form = calls[0]!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const wire = await new Response(form).text();
    expect(wire).toContain('name="formalityData"');
    expect(wire).toContain('Content-Type: application/json');
    expect(wire).toContain('"probe":true');
  });

  it('AC2: getPortCalls refuses a missing or malformed window before any HTTP', async () => {
    const { service, calls } = makeClient();
    await expect(
      service.getPortCalls('mock', { timeWindowStart: '2026-09-24', timeWindowEnd: 'soon' }),
    ).rejects.toBeInstanceOf(NemoUsageError);
    await expect(
      service.getPortCalls('mock', undefined as unknown as PortCallListWindow),
    ).rejects.toBeInstanceOf(NemoUsageError);
    expect(calls).toHaveLength(0);
  });

  it('AC2: a valid window travels as both query parameters', async () => {
    const { service, calls } = makeClient();
    await service.getPortCalls(
      'mock',
      { timeWindowStart: '2026-09-24', timeWindowEnd: '2026-09-30' },
      { shipIMONumbers: '9990026' },
    );
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/portcalls');
    expect(url.searchParams.get('timeWindowStart')).toBe('2026-09-24');
    expect(url.searchParams.get('timeWindowEnd')).toBe('2026-09-30');
    expect(url.searchParams.get('shipIMONumbers')).toBe('9990026');
  });

  it('AC3: normalizePortCallStatus maps any casing to the vendored spelling', () => {
    expect(normalizePortCallStatus('UNCONFIRMED')).toBe('Unconfirmed');
    expect(normalizePortCallStatus('Arriving')).toBe('Arriving');
    expect(normalizePortCallStatus('moored')).toBe('Moored');
    expect(normalizePortCallStatus(' DEPARTED ')).toBe('Departed');
    expect(normalizePortCallStatus('CANCELLED')).toBe('Cancelled');
    expect(normalizePortCallStatus('nonsense')).toBeNull();
    expect(normalizePortCallStatus(undefined)).toBeNull();
  });

  it('AC4: the UI backend create goes to <origin>/nemo-ui/api/v2/portcalls and is audited', async () => {
    const { service, calls, content } = makeClient();
    await service.createPortCallViaUiBackend('mock', {
      shipName: 'CARISMA',
      shipImoNumber: '9990026',
      eta: '2026-09-27T08:00:00Z',
      portLocationCode: 'FIRAU',
    });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://127.0.0.1:4010/nemo-ui/api/v2/portcalls');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    const request = content.mock.calls.find((c) => c[0].data.phase === 'request')?.[0];
    expect(request.entityType).toBe('nemo_submission');
    expect(request.data.action).toBe('create_port_call_ui_backend');
    expect(request.data.undocumented).toBe(true);
  });

  it('AC4: findShips reads the NSD search route with the UI-bundle parameter name', async () => {
    const { service, calls, responses } = makeClient();
    responses.push(() => [
      { id: 'b3f97113-a3a8-4c6f-9cb3-474565548da7', name: 'CARISMA', imoid: '9990026' },
    ]);
    const hits = await service.findShips('mock', '9990026');
    expect(calls[0]!.url).toBe(
      'http://127.0.0.1:4010/nsd/api/v2/ships/searchshipid?queryparameter=9990026',
    );
    expect(hits[0]!.id).toBe('b3f97113-a3a8-4c6f-9cb3-474565548da7');
    const detail = await service.getPortCallViaUiBackend('mock', 'FI20260924-031-9');
    expect(calls[1]!.url).toBe('http://127.0.0.1:4010/nemo-ui/api/v2/portcalls/FI20260924-031-9');
    expect(detail).toEqual({ ok: true });
  });


  it('AC7: the request type has no registeredOwnerName', () => {
    const body: PortCallRequestBody = {
      shipName: 'MAIA',
      portLocationCode: 'FIRAU',
      eta: '2026-09-27T08:00:00Z',
    };
    // @ts-expect-error the live API rejects the field the vendored spec required
    const rejected: PortCallRequestBody = { ...body, registeredOwnerName: 'x' };
    expect(rejected.shipName).toBe('MAIA');
  });
});

describe('nemo-client NSD record (spec 0064 AC 5)', () => {

  it('getShip answers null for a body that is not a ship record', async () => {
    const { service, responses } = makeClient({ NEMO_TARGET: 'stg' });
    responses.push(() => ({ ok: true }));
    expect(await service.getShip('fleetco', 'nope')).toBeNull();
  });
});



// One production hazmat service, found on the target's own host (spec 0062
// F10 amendment 2026-09-24); the NEMO UI for by-hand steps (spec 0067 AC 8).
describe('target-derived supporting URLs', () => {

});
