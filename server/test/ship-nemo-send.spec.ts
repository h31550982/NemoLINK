/**
 * Ship data to NEMO (spec 0070 AC 3–5): the confirmation names what goes
 * and why not; a send posts SID then SHP, keeps NEMO's outer id, updates on
 * a resend and records a rejection as a receipt; a port call is created in
 * NEMO through the Declarant API, the UI-backend route for an unknown ship,
 * and the manual-VID words when that refuses.
 */
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import { ShipNemoService, visitCancelledIn, visitGoneHint } from '../src/admin/ship-nemo.service';
import type { ShipRow, ShipsService } from '../src/admin/ships.service';
import type { PortCallService } from '../src/canonical/port-call.service';
import type { CertificateFilesService } from '../src/admin/certificate-files.service';
import { MigValidator } from '../src/nemo-client/mig-validator';
import { NemoApiError, type NemoClientService } from '../src/nemo-client/nemo-client.service';
import { eoriOfClientId, type NemoCredentialService } from '../src/nemo-client/nemo-credential.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import type { DocumentsService } from '../src/ingest/documents/documents.service';
import type { ObligationSnapshot } from '../src/canonical/obligations';
import { noaSnapshot } from './noa-fixture';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@fleetco.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'fleetco',
  orgName: 'Fleetco Oy',
};

const SHIP = {
  id: 'ship-1',
  name: 'CARISMA',
  imoNumber: '9990026',
  mmsi: '230666669',
  callSign: 'ABCD',
  particulars: {
    ownerName: 'nauticAi test owner (dummy)',
    operatorName: 'nauticAi test operator (dummy)',
    iceClass: { code: 'FSIII' },
    openWaterSpeedMeasure: 10,
    grossWeight: 2999,
  },
} as unknown as ShipRow;

const ACCEPTED = {
  'env:Envelope': {
    'res:RES': { 'res:SpecifiedLogisticsTransportMovement': { 'ram:CallTransportEvent': { 'ram:ID': 'FI20260925-013-0' } } },
    'frm:FRM': { 'frm:AcknowledgementDocument': { 'ram:StatusCode': '1', 'ram:ReferencedReportedError': [] } },
  },
};
// The live 400 shape (spec 0078): the FRM under `frmResponse`, the JSON error beside it
const REJECTED_NO_ERRORS = JSON.stringify({
  frmResponse: { 'env:Envelope': { 'frm:FRM': { 'frm:AcknowledgementDocument': { 'ram:StatusCode': '8', 'ram:ClearanceModelConditionCode': 'CLR-03', 'ram:ReferencedReportedError': [] } } } },
  errorKey: 'BAD_REQUEST',
  errorDescription: ['Virheellinen pyyntö.', 'Bad request.', 'Felaktig begäran.'],
});
const REJECTED_WITH_ERROR = JSON.stringify({
  frmResponse: {
    'env:Envelope': {
      'frm:FRM': {
        'frm:AcknowledgementDocument': {
          'ram:StatusCode': '8',
          'ram:ReferencedReportedError': [
            {
              'ram:TypeCode': 'ERR-099',
              'ram:Description': ['Omistajan nimi on liian pitkä', 'Owner name too long', 'Ägarens namn är för långt'],
              'ram:SpecifiedIdentifiedPointer': [{ 'ram:TagID': '$.shipName' }],
            },
          ],
        },
      },
    },
  },
  errorKey: 'VALIDATION_FAILED',
  errorMessage: 'Validation failed',
  fieldErrors: [{ type: 'rule', paths: ['$.shipName'], errorKey: 'ERR-099', errorMsg: 'Owner name too long' }],
});

interface Opts {
  call?: Partial<{ visit_id: string | null; port_locode: string | null; eta: Date | null; etd: Date | null; status: string | null; ship_id: string | null; nemo: Record<string, unknown> | null }> | null;
  org?: { name: string; eori: string | null; data?: Record<string, unknown> };
  nemo?: Partial<Record<keyof NemoClientService, jest.Mock>>;
  ship?: ShipRow;
  /** The key on the target; null = none stored (resolve rejects). */
  key?: { clientId: string } | null;
  target?: 'stg' | 'mock';
  certFiles?: Map<string, { fileName: string; description: string; sha256: string }[]>;
  /** The call's checklist snapshot (the NOA, spec 0088). */
  snapshot?: ObligationSnapshot;
  /** The call's NEMO tables (spec 0098); none = no documents service. */
  tables?: { key: string; header: Record<string, unknown>; rows: unknown[]; sources?: unknown[] }[];
  /** The call's audit chain rows a read finds (NEMO's last refusal, spec 0098). */
  audit?: { created: Date; data: Record<string, unknown> }[];
}

function harness(opts: Opts = {}) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const call = opts.call === null ? null : {
    id: 'pc-1', visit_id: 'FI20260925-013-0', port_locode: 'FIRAU', eta: new Date('2026-09-26T08:00:00Z'), etd: new Date('2026-09-26T20:00:00Z'), status: 'expected', ship_id: 'ship-1', nemo: null,
    ...(opts.call ?? {}),
  };
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM port_call WHERE id')) return { rowCount: call ? 1 : 0, rows: call ? [call] : [] };
    if (sql.includes('FROM audit_event')) return { rowCount: opts.audit?.length ?? 0, rows: (opts.audit ?? []) as never[] };
    if (sql.includes('FROM platform.organization')) {
      const org = opts.org ?? { name: 'Fleetco (nauticAi)', eori: 'FI2790804-3', data: { 'ram:CarrierAgentTradeParty': { 'ram:Name': 'Fleetco Agency' } } };
      return { rowCount: 1, rows: [org] };
    }
    return { rowCount: 1, rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  const tenantDb = {
    schemaFor: jest.fn(async () => 'org_fleetco'),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
    platform: jest.fn(async (fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
  } as unknown as TenantDb;
  const content = jest.fn(async () => 'audit-1');
  const nemo = {
    target: opts.target ?? 'stg',
    uiUrl: 'https://nemo.example/',
    createFormality: jest.fn(async () => ACCEPTED),
    updateFormality: jest.fn(async () => ACCEPTED),
    getFormalities: jest.fn(async () => []),
    createPortCall: jest.fn(async () => ACCEPTED),
    createPortCallViaUiBackend: jest.fn(async () => ({ visitId: 'FI20260925-099-9' })),
    ...(opts.nemo ?? {}),
  };
  const ships = { get: jest.fn(async () => opts.ship ?? SHIP) } as unknown as ShipsService;
  const key = opts.key === undefined ? { clientId: '1471406-3' } : opts.key;
  const credentials = {
    resolve: jest.fn(async () => {
      if (!key) throw new Error('No active NEMO credential');
      return { clientId: key.clientId, clientSecret: 's3cr3t', businessId: key.clientId };
    }),
  } as unknown as NemoCredentialService;
  // the soft cancel the COA ends with (spec 0080)
  const portCalls = {
    cancel: jest.fn(async () => undefined),
    snapshotFor: jest.fn(async () => ({ row: {}, snapshot: opts.snapshot ?? noaSnapshot() })),
    portAreas: jest.fn(async () => [{ code: 'FIRAU-BB', gisisCode: 'FIRAU-0004', berths: [] }]),
  };
  const documents = opts.tables ? { formTables: jest.fn(async () => opts.tables) } : undefined;
  // the certificate files of the CRT (spec 0084)
  const certFiles = {
    summaryOf: jest.fn(async () => opts.certFiles ?? new Map()),
    contentsOf: jest.fn(async () => [{ fileName: 'cl.pdf', description: 'CL certificate', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4') }]),
  };
  const service = new ShipNemoService(
    tenantDb,
    { content } as unknown as AuditService,
    nemo as unknown as NemoClientService,
    new MigValidator(),
    ships,
    credentials,
    portCalls as unknown as PortCallService,
    certFiles as unknown as CertificateFilesService,
    documents as unknown as DocumentsService,
  );
  return { service, calls, content, nemo, query, portCalls, certFiles, documents };
}

describe('preview — the confirmation (spec 0070 AC 3)', () => {
  it('names the fields with their ids, the declarant, and two reports that will go', async () => {
    const { service } = harness();
    const p = await service.preview(ADMIN, 'ship-1', 'pc-1');
    // the declarant is the key's organisation (EORI_DOES_NOT_MATCH otherwise, live 2026-09-25)
    expect(p.declarant).toEqual({ id: 'FI1471406-3', roleCode: 'AG', name: 'Fleetco Agency' });
    expect(p.declarantNote).toMatch(/client id 1471406-3/);
    expect(p.portCall?.visitId).toBe('FI20260925-013-0');
    expect(p.fields.find((f) => f.key === 'iceClass')).toMatchObject({ formality: 'SHP', de: 'DE-009-03', sent: true });
    expect(p.fields.find((f) => f.key === 'grossWeight')).toMatchObject({ formality: 'NOA', sent: false });
    expect(p.formalities.map((f) => [f.type, f.willSend, f.reason])).toEqual([
      ['SID', true, null],
      ['SHP', true, null],
    ]);
    expect(p.formalities[1]!.envelope!['env:Envelope']).toBeDefined();
    expect(p.policy).toMatch(/The full ship data NEMOLink holds is sent with every port call/);
  });

  it('without a port call, a visit id or an EORI it says what is missing and sends nothing', async () => {
    const none = await harness().service.preview(ADMIN, 'ship-1');
    expect(none.formalities.every((f) => !f.willSend && /Pick a port call/.test(f.reason!))).toBe(true);

    const noVisit = await harness({ call: { visit_id: null } }).service.preview(ADMIN, 'ship-1', 'pc-1');
    expect(noVisit.formalities[0]!.reason).toMatch(/Create the port call in NEMO first/);

    // no EORI of its own and no key to derive one from
    const noEori = await harness({ org: { name: 'X', eori: null }, key: null }).service.preview(ADMIN, 'ship-1', 'pc-1');
    expect(noEori.declarant).toBeNull();
    expect(noEori.formalities[0]!.reason).toMatch(/EORI/);
  });

  it('the declarant EORI follows the key; the org’s own EORI is the fallback (spec 0070 amendment)', async () => {
    expect(eoriOfClientId('1471406-3')).toBe('FI1471406-3');
    expect(eoriOfClientId('nemolink-acmeship')).toBeNull();
    expect(eoriOfClientId(null)).toBeNull();

    const notYtunnus = await harness({ key: { clientId: 'nemolink-acmeship' } }).service.preview(ADMIN, 'ship-1', 'pc-1');
    expect(notYtunnus.declarant?.id).toBe('FI2790804-3');
    expect(notYtunnus.declarantNote).toMatch(/declarant details/);

    const noKey = await harness({ key: null }).service.preview(ADMIN, 'ship-1', 'pc-1');
    expect(noKey.declarant?.id).toBe('FI2790804-3');

    const mock = await harness({ target: 'mock' }).service.preview(ADMIN, 'ship-1', 'pc-1');
    expect(mock.declarant?.id).toBe('FI2790804-3');
  });

  it('refuses a port call of another ship', async () => {
    const { service } = harness({ call: { ship_id: 'ship-2' } });
    await expect(service.preview(ADMIN, 'ship-1', 'pc-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('send — SID then SHP, receipts, ids (spec 0070 AC 4)', () => {
  it('posts both, keeps NEMO’s outer id from the list, stores the facts and audits each', async () => {
    const getFormalities = jest.fn(async () => [
      { formalityType: 'SID', formalityId: 'outer-sid', formality: { 'env:Envelope': { 'mai:MAI': { 'mai:ExchangedDocument': { 'ram:ID': 'unknown' } } } } },
      { formalityType: 'SHP', formalityId: 'outer-shp', formality: {} },
    ]);
    const { service, nemo, calls, content } = harness({ nemo: { getFormalities } });
    const receipt = await service.send(ADMIN, 'ship-1', 'pc-1');
    expect(receipt.visitId).toBe('FI20260925-013-0');
    expect(receipt.results.map((r) => [r.type, r.accepted, r.status, r.update, r.formalityId])).toEqual([
      ['SID', true, '1', false, 'outer-sid'],
      ['SHP', true, '1', false, 'outer-shp'],
    ]);
    expect(nemo.createFormality).toHaveBeenCalledTimes(2);
    expect(nemo.createFormality.mock.calls[0]![2]).toBe('SID');
    expect(nemo.createFormality.mock.calls[1]![2]).toBe('SHP');
    const updates = calls.filter((c) => c.sql.includes('UPDATE port_call'));
    // two sends, then one read-back of NEMO's copy (spec 0089)
    expect(updates).toHaveLength(3);
    expect(JSON.parse(updates[1]!.params![1] as string)).toEqual({
      SHP: expect.objectContaining({ formalityId: 'outer-shp', accepted: true, status: '1', version: 1, errors: 0 }),
    });
    expect(content).toHaveBeenCalledTimes(3);
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'port_call', data: expect.objectContaining({ action: 'nemo_formality_sent', formalityType: 'SID', accepted: true }) }),
      expect.anything(),
    );
    // NEMO's list held no data for them here: the read-back says so
    expect(receipt.results.map((r) => r.exchange.readBack?.state)).toEqual(['differs', 'differs']);
  });

  it('reads NEMO’s copy back after the send and says it holds what we sent (spec 0089)', async () => {
    let held: Record<string, unknown>[] = [];
    const createFormality = jest.fn(async (_org: string, _visit: string, type: string, envelope: Record<string, unknown>) => {
      held.push({ formalityType: type, formalityId: 'outer-' + type.toLowerCase(), status: 'SUBMITTED', formality: envelope });
      return ACCEPTED;
    });
    const getFormalities = jest.fn(async () => held);
    const { service } = harness({ nemo: { createFormality, getFormalities } });
    const receipt = await service.send(ADMIN, 'ship-1', 'pc-1');
    expect(receipt.results.map((r) => r.exchange.readBack?.state)).toEqual(['same', 'same']);
    held = [];
  });

  it('a second send updates with the outer id (PUT), never posts twice', async () => {
    const { service, nemo } = harness({
      call: { nemo: { formalities: { SID: { formalityId: 'outer-sid', version: 1 }, SHP: { formalityId: 'outer-shp', version: 1 } } } },
    });
    const receipt = await service.send(ADMIN, 'ship-1', 'pc-1');
    expect(nemo.createFormality).not.toHaveBeenCalled();
    expect(nemo.updateFormality).toHaveBeenCalledTimes(2);
    expect(nemo.updateFormality.mock.calls[0]!.slice(1, 4)).toEqual(['FI20260925-013-0', 'SID', 'outer-sid']);
    expect(receipt.results.every((r) => r.update && r.accepted)).toBe(true);
  });

  it('a rejection is a receipt with NEMO’s errors, recorded, not an exception', async () => {
    const createFormality = jest
      .fn()
      .mockResolvedValueOnce(ACCEPTED)
      .mockRejectedValueOnce(new NemoApiError(400, REJECTED_WITH_ERROR));
    const { service, calls } = harness({ nemo: { createFormality } });
    const receipt = await service.send(ADMIN, 'ship-1', 'pc-1');
    expect(receipt.results[1]).toMatchObject({
      type: 'SHP',
      accepted: false,
      status: '8',
      errors: [{ code: 'ERR-099', message: 'Owner name too long', path: '$.shipName' }],
      formalityId: null,
    });
    const shpFact = JSON.parse(calls.filter((c) => c.sql.includes('UPDATE port_call'))[1]!.params![1] as string).SHP;
    expect(shpFact).toMatchObject({ accepted: false, status: '8', errors: 1, version: 0 });
  });

  it('refuses to send without a visit id', async () => {
    const { service } = harness({ call: { visit_id: null } });
    await expect(service.send(ADMIN, 'ship-1', 'pc-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('createInNemo — the VID (spec 0070 AC 5)', () => {
  it('creates through the Declarant API and stores the visit id', async () => {
    const { service, nemo, calls, content } = harness({ call: { visit_id: null } });
    const out = await service.createInNemo(ADMIN, 'pc-1');
    expect(out).toMatchObject({ visitId: 'FI20260925-013-0', route: 'declarant-api', exchange: { operation: 'VID', outcome: 'success', visitId: 'FI20260925-013-0', auditId: 'audit-1' } });
    expect(nemo.createPortCall).toHaveBeenCalledWith('fleetco', {
      // the bare minimum (spec 0082): no MMSI, no call sign — they go in the SID
      shipName: 'CARISMA', shipImoNumber: '9990026',
      eta: '2026-09-26T08:00:00.000Z', etd: '2026-09-26T20:00:00.000Z', portLocationCode: 'FIRAU',
    });
    const update = calls.find((c) => c.sql.includes('visit_id = $2'))!;
    expect(update.params![1]).toBe('FI20260925-013-0');
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'nemo_port_call_created', visitId: 'FI20260925-013-0' }) }),
      expect.anything(),
    );
  });

  it('a ship NEMO does not know: the UI-backend route, then the manual-VID words when it refuses', async () => {
    const unknownShip = () => new NemoApiError(400, REJECTED_NO_ERRORS);
    const viaUi = harness({ call: { visit_id: null }, nemo: { createPortCall: jest.fn().mockRejectedValue(unknownShip()) } });
    await expect(viaUi.service.createInNemo(ADMIN, 'pc-1')).resolves.toMatchObject({ visitId: 'FI20260925-099-9', route: 'ui-backend' });

    const refused = harness({
      call: { visit_id: null },
      nemo: { createPortCall: jest.fn().mockRejectedValue(unknownShip()), createPortCallViaUiBackend: jest.fn().mockRejectedValue(new NemoApiError(403, '')) },
    });
    let message = '';
    await refused.service.createInNemo(ADMIN, 'pc-1').catch((e: Error) => (message = e.message));
    expect(message).toContain('needs to be created manually in NEMO by making its first VID');
    expect(message).toContain('https://nemo.example/');
    // the refusal is on the chain, whole (spec 0078: the NEMO log)
    expect(refused.content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'port_call',
        entityId: 'pc-1',
        data: expect.objectContaining({
          action: 'nemo_port_call_refused',
          httpStatus: 400,
          frmStatus: '8',
          shipUnknown: true,
          words: 'BAD_REQUEST Bad request.',
          request: expect.objectContaining({ shipImoNumber: expect.any(String) }),
          response: expect.objectContaining({ errorKey: 'BAD_REQUEST' }),
        }),
      }),
      expect.anything(),
    );
  });

  it('a refusal with errors is said back; an existing visit id is a conflict', async () => {
    const withErrors = harness({ call: { visit_id: null }, nemo: { createPortCall: jest.fn().mockRejectedValue(new NemoApiError(400, REJECTED_WITH_ERROR)) } });
    await expect(withErrors.service.createInNemo(ADMIN, 'pc-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(withErrors.service.createInNemo(ADMIN, 'pc-1')).rejects.toThrow(/ERR-099 Owner name too long \(\$\.shipName\)/);
    expect(withErrors.content).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'nemo_port_call_refused', shipUnknown: false, frmStatus: '8' }) }),
      expect.anything(),
    );

    await expect(harness().service.createInNemo(ADMIN, 'pc-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('invariant 4 — sending is an org-member act (spec 0076)', () => {
  const ACTING: SessionUser = { ...ADMIN, username: 'dev@nauticai.example', platformAdmin: true, acting: true };

  it('an acting platform admin is refused the VID and the ship data, before NEMO or the database is touched', async () => {
    const vid = harness({ call: { visit_id: null } });
    await expect(vid.service.createInNemo(ACTING, 'pc-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(vid.service.createInNemo(ACTING, 'pc-1')).rejects.toThrow(/organisation’s own people/);
    expect(vid.nemo.createPortCall).not.toHaveBeenCalled();
    expect(vid.calls).toHaveLength(0);

    const data = harness();
    await expect(data.service.send(ACTING, 'ship-1', 'pc-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(data.nemo.createFormality).not.toHaveBeenCalled();
    expect(data.calls).toHaveLength(0);
  });

  it('the preview stays open to them — preparing and reviewing is allowed', async () => {
    const { service } = harness();
    await expect(service.preview(ACTING, 'ship-1', 'pc-1')).resolves.toBeDefined();
  });
});

describe('cancel — the COA (spec 0080)', () => {
  const REASON = 'Voyage cancelled by the charterer (dummy)';
  const ACTING: SessionUser = { ...ADMIN, username: 'dev@nauticai.example', platformAdmin: true, acting: true };

  it('in NEMO: posts the COA with the reason as its remark, keeps the fact and the exchange, then cancels here in the same transaction', async () => {
    const h = harness();
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).resolves.toMatchObject({ visitId: 'FI20260925-013-0', sent: true, exchange: { operation: 'COA', outcome: 'success', visitId: 'FI20260925-013-0' } });
    expect(h.nemo.createFormality).toHaveBeenCalledTimes(1);
    const [, visitId, type, envelope] = h.nemo.createFormality.mock.calls[0] as [string, string, string, Record<string, unknown>];
    expect(visitId).toBe('FI20260925-013-0');
    expect(type).toBe('COA');
    const env = envelope['env:Envelope'] as Record<string, unknown>;
    expect(env['coa:COA']).toEqual({ 'coa:ExchangedDocument': { 'ram:Remarks': { $: REASON, '@languageID': 'EN' } } });
    expect((env['mai:MAI'] as Record<string, Record<string, unknown>>)['mai:SpecifiedLogisticsTransportMovement']).toEqual({
      'ram:CallTransportEvent': { 'ram:ID': 'FI20260925-013-0' },
    });
    // the fact under data.nemo.formalities — submittedOf then says COA, nemoStatus says Cancelled
    const factUpdate = h.calls.find((c) => c.sql.includes("'formalities'"));
    expect(factUpdate).toBeDefined();
    expect(JSON.parse(String(factUpdate!.params![1]))).toEqual({
      COA: expect.objectContaining({ accepted: true, status: '1', errors: 0, version: 1, documentId: expect.any(String) }),
    });
    // the exchange, whole, on the chain (spec 0078)
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'port_call',
        entityId: 'pc-1',
        data: expect.objectContaining({
          action: 'nemo_formality_sent',
          formalityType: 'COA',
          accepted: true,
          status: '1',
          request: expect.objectContaining({ 'env:Envelope': expect.anything() }),
          response: ACCEPTED,
        }),
      }),
      expect.anything(),
    );
    // the soft cancel of spec 0034, inside the same transaction, with the reason
    expect(h.portCalls.cancel).toHaveBeenCalledWith(ADMIN, 'pc-1', REASON, expect.anything());
  });

  it('a refusal is kept on the chain and said back; nothing is cancelled here', async () => {
    const h = harness({
      nemo: { createFormality: jest.fn().mockRejectedValueOnce(new NemoApiError(400, REJECTED_WITH_ERROR)) },
    });
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).rejects.toThrow(
      /NEMO refused the cancellation: ERR-099 Owner name too long \(\$\.shipName\)/,
    );
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
    expect(h.calls.some((c) => c.sql.includes("'formalities'"))).toBe(false);
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'nemo_formality_sent', formalityType: 'COA', accepted: false, status: '8' }),
      }),
      expect.anything(),
    );
  });

  it('ERR-023 (NEMO cancelled the visit already): the call is unlinked, its VID unsent again, not cancelled here', async () => {
    const visitCancelled = JSON.stringify({
      frmResponse: { 'env:Envelope': { 'frm:FRM': { 'frm:AcknowledgementDocument': {
        'ram:StatusCode': '8',
        'ram:ReferencedReportedError': [{
          'ram:TypeCode': 'ERR-023',
          'ram:Description': ['Ilmoitus hylätään, koska käynti on peruttu.', 'The formality is rejected because the visit is cancelled.', 'Formaliteten avvisas eftersom anlöpet är avbrutet.'],
        }],
      } } } },
      errorKey: 'BAD_REQUEST',
    });
    const h = harness({ nemo: { createFormality: jest.fn().mockRejectedValueOnce(new NemoApiError(400, visitCancelled)) } });
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).resolves.toMatchObject({
      visitId: 'FI20260925-013-0',
      exchange: { operation: 'COA', outcome: 'rejected', headline: 'NEMO had already cancelled FI20260925-013-0' },
    });
    const unlink = h.calls.find((c) => c.sql.includes('visit_id = NULL'));
    expect(unlink?.sql).toContain('previousVisits');
    expect(JSON.parse((unlink!.params as string[])[1]!)).toMatchObject({ visitId: 'FI20260925-013-0', reason: expect.stringMatching(/ERR-023/) });
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'nemo_visit_unlinked', visitId: 'FI20260925-013-0' }) }),
      expect.anything(),
    );
  });

  it('a status other than 1 without an HTTP error is a refusal too', async () => {
    const h = harness({
      nemo: { createFormality: jest.fn(async () => JSON.parse(REJECTED_NO_ERRORS).frmResponse) },
    });
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).rejects.toThrow(/NEMO refused the cancellation: status 8/);
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
  });

  it('in NEMO the reason is required — it is the COA remark NEMO wants (DE-003-01)', async () => {
    const h = harness();
    await expect(h.service.cancel(ADMIN, 'pc-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.cancel(ADMIN, 'pc-1', '   ')).rejects.toThrow(/Give the reason/);
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
  });

  it('not in NEMO: the soft cancel alone, NEMO untouched, no reason needed', async () => {
    const h = harness({ call: { visit_id: null } });
    await expect(h.service.cancel(ADMIN, 'pc-1')).resolves.toEqual({ visitId: null, sent: false, exchange: null });
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.portCalls.cancel).toHaveBeenCalledWith(ADMIN, 'pc-1', undefined);
  });

  it('already cancelled: idempotent through the soft cancel, no second COA', async () => {
    const h = harness({ call: { status: 'cancelled' } });
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).resolves.toEqual({ visitId: 'FI20260925-013-0', sent: false, exchange: null });
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
  });

  it('an acting platform admin cannot cancel a call that is in NEMO — the COA is a send (invariant 4)', async () => {
    const h = harness();
    await expect(h.service.cancel(ACTING, 'pc-1', REASON)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
  });

  it('a departed call cannot be cancelled, in NEMO or not', async () => {
    const h = harness({ call: { status: 'departed' } });
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).rejects.toThrow(/departed port call cannot be cancelled/);
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
  });
});

describe('the exchange — NEMO unavailable is not a rejection (spec 0081)', () => {
  const tokenDown = () => new NemoApiError(503, '', 'token endpoint responded 503', 'token');

  it('SID+SHP with NEMO’s sign-in down: SID unavailable, SHP not tried, no fact overwritten, the attempt on the chain', async () => {
    const createFormality = jest.fn().mockRejectedValue(tokenDown());
    const h = harness({ nemo: { createFormality } });
    const receipt = await h.service.send(ADMIN, 'ship-1', 'pc-1');
    expect(createFormality).toHaveBeenCalledTimes(1);
    expect(receipt.results.map((r) => [r.type, r.outcome, r.accepted])).toEqual([
      ['SID', 'unavailable', false],
      ['SHP', 'unavailable', false],
    ]);
    expect(receipt.results[0]!.exchange).toMatchObject({
      visitId: 'FI20260925-013-0',
      httpStatus: 503,
      headline: 'NEMO is unavailable — nothing was sent',
      explanation: expect.stringContaining('503 Service Unavailable'),
      auditId: 'audit-1',
    });
    expect(receipt.results[1]!.exchange.headline).toBe('SHP not sent — NEMO is unavailable');
    expect(h.calls.some((c) => c.sql.includes("'formalities'"))).toBe(false);
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'nemo_formality_sent', outcome: 'unavailable', httpStatus: 503 }),
      }),
      expect.anything(),
    );
  });

  it('the VID with NEMO down: 503 with the exchange, recorded on the chain, no visit id stored', async () => {
    const h = harness({
      call: { visit_id: null },
      nemo: { createPortCall: jest.fn().mockRejectedValue(new NemoApiError(503, '<html>down</html>')) },
    });
    const err = await h.service.createInNemo(ADMIN, 'pc-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const body = (err as ServiceUnavailableException).getResponse() as { exchange: Record<string, unknown> };
    expect(body.exchange).toMatchObject({ operation: 'VID', outcome: 'unavailable', httpStatus: 503, visitId: null, auditId: 'audit-1' });
    expect(h.calls.some((c) => c.sql.includes('visit_id = $2'))).toBe(false);
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'nemo_port_call_refused', outcome: 'unavailable' }) }),
      expect.anything(),
    );
  });

  it('a refused key at the sign-in is an error that names the key, not an outage', async () => {
    const h = harness({
      call: { visit_id: null },
      nemo: { createPortCall: jest.fn().mockRejectedValue(new NemoApiError(401, '', 'token endpoint responded 401', 'token')) },
    });
    const err = await h.service.createInNemo(ADMIN, 'pc-1').catch((e: unknown) => e);
    const body = (err as ServiceUnavailableException).getResponse() as { exchange: Record<string, unknown> };
    expect(body.exchange).toMatchObject({ outcome: 'error', headline: "NEMO did not accept NEMOLink's key" });
  });

  it('the COA with NEMO down: 503, nothing cancelled here', async () => {
    const h = harness({ nemo: { createFormality: jest.fn().mockRejectedValue(tokenDown()) } });
    const err = await h.service.cancel(ADMIN, 'pc-1', 'test trip').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
  });
});

describe('cancel — NEMO refuses the COA after the ATA (spec 0080 amendment)', () => {
  it('an accepted ATA: refused before NEMO, nothing cancelled', async () => {
    const h = harness({ call: { nemo: { formalities: { ATA: { accepted: true, status: '1' } } } } });
    await expect(h.service.cancel(ADMIN, 'pc-1', 'Port changed')).rejects.toThrow(/once its ATA/);
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
  });
});

describe('send — the CRT goes with SID and SHP (spec 0084)', () => {
  const CERT = {
    typeCode: 'CL', certificateId: 'CL-123', issueDate: '2024-01-10', expiryDate: '2029-01-09', extendedUntil: null,
    description: null, issuer: null, issuerTypeCode: '02', issuerId: 'DNV', issuerCountry: null,
  };
  const withCert = {
    ...SHIP,
    certificates: [CERT],
    particulars: { ...(SHIP as unknown as { particulars: Record<string, unknown> }).particulars, iceClass: { code: 'FS1A' } },
    nemo: null,
  } as unknown as ShipRow;
  const files = new Map([['CL:CL-123', [{ fileName: 'cl.pdf', description: 'CL certificate CL-123', sha256: 'aa' }]]]);

  it('the preview lists the CRT with its file; the send posts it with the file, an LRN and the ice class request', async () => {
    const h = harness({ ship: withCert, certFiles: files });
    const p = await h.service.preview(ADMIN, 'ship-1', 'pc-1');
    const crt = p.formalities.find((f) => f.type === 'CRT')!;
    expect(crt).toMatchObject({ certKey: 'CL:CL-123', willSend: true, iceClassConfirmation: true, files: [{ fileName: 'cl.pdf', description: 'CL certificate CL-123' }] });
    expect(crt.problems).toEqual([]);

    const receipt = await h.service.send(ADMIN, 'ship-1', 'pc-1');
    expect(receipt.results.map((r) => r.type)).toEqual(['SID', 'SHP', 'CRT']);
    expect(receipt.results[2]!.exchange.operation).toBe('CRT CL');
    const call = h.nemo.createFormality.mock.calls[2] as unknown as [string, string, string, Record<string, any>, Record<string, any>];
    expect(call[2]).toBe('CRT');
    expect(call[3]['env:Envelope']['mai:MAI']['mai:ExchangedDeclaration']['ram:ID']).toMatch(/^[A-Z0-9]{22}$/);
    expect(call[4]).toMatchObject({ requestIceClassConfirmation: true, attachments: [{ fileName: 'cl.pdf', contentType: 'application/pdf' }] });
    expect(h.certFiles.contentsOf).toHaveBeenCalledWith('fleetco', 'ship-1', 'CL:CL-123');
    // the fact is kept per certificate, with its LRN for later updates
    const facts = h.calls.filter((c) => c.sql.includes("'formalities'")).map((c) => JSON.parse(String(c.params![1])));
    expect(facts[2]['CRT:CL:CL-123']).toMatchObject({ accepted: true, lrn: expect.stringMatching(/^[A-Z0-9]{22}$/) });
    // and the org's fleet row remembers it was reported
    expect(h.calls.some((c) => c.sql.includes('nemoCertificates'))).toBe(true);
  });

  it('a certificate without its file does not go, and the preview says why', async () => {
    const h = harness({ ship: withCert });
    const crt = (await h.service.preview(ADMIN, 'ship-1', 'pc-1')).formalities.find((f) => f.type === 'CRT')!;
    expect(crt).toMatchObject({ willSend: false, reason: 'missing: the certificate file (NEMO requires it)' });
    // Data missing in one stops the send (user 2026-11-13); the others still go on their own
    await expect(h.service.send(ADMIN, 'ship-1', 'pc-1')).rejects.toThrow(/Data missing — nothing was sent: CRT CL/);
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    const receipt = await h.service.send(ADMIN, 'ship-1', 'pc-1', ['SID', 'SHP']);
    expect(receipt.results.map((r) => r.type)).toEqual(['SID', 'SHP']);
  });
});

/** Every pre-arrival report unticked: a ticked one short of data would hold the NOA (user 2026-11-13). */
const offAll = (...codes: string[]) =>
  Object.fromEntries((codes.length ? codes : ['CWA', 'EFF', 'STA', 'WAS', 'SEC']).map((c) => [c, { on: false, by: 'Admin', at: '2026-10-06T10:00:00Z' }]));

describe('the NOA (spec 0088)', () => {
  const noaOf = (nemo: { createFormality: jest.Mock }) => nemo.createFormality.mock.calls[0]![3] as Record<string, any>;

  it('sends it unconfirmed when the sender says so: no statement, none on the fact', async () => {
    const { service, nemo, calls } = harness({ call: { nemo: { reports: offAll() } } });
    const receipt = await service.sendNoa(ADMIN, 'pc-1', false);
    expect(nemo.createFormality.mock.calls[0]![2]).toBe('NOA');
    expect(noaOf(nemo)['env:Envelope']['noa:NOA']['noa:ExchangedDeclaration']).toBeUndefined();
    expect(receipt.results[0]!.accepted).toBe(true);
    const fact = JSON.parse(calls.find((c) => c.sql.includes('UPDATE port_call') && c.sql.includes('formalities'))!.params![1] as string).NOA;
    expect(fact.statement).toBeUndefined();
  });

  it('confirms the arrival when the sender says so: ST-FI-01 on the NOA and on the fact', async () => {
    const { service, nemo, calls } = harness({ call: { nemo: { reports: offAll() } } });
    await service.sendNoa(ADMIN, 'pc-1', true);
    expect(noaOf(nemo)['env:Envelope']['noa:NOA']['noa:ExchangedDeclaration']).toEqual({ 'ram:StatementTypeCode': 'ST-FI-01' });
    const fact = JSON.parse(calls.find((c) => c.sql.includes('UPDATE port_call') && c.sql.includes('formalities'))!.params![1] as string).NOA;
    expect(fact.statement).toBe('ST-FI-01');
  });

  it('an update of a confirmed NOA keeps the confirmation (it cannot be withdrawn)', async () => {
    const { service, nemo } = harness({
      call: { nemo: { reports: offAll(), formalities: { NOA: { formalityId: 'outer-noa', accepted: true, version: 1, statement: 'ST-FI-01' } } } },
    });
    await service.sendNoa(ADMIN, 'pc-1', false);
    const envelope = nemo.updateFormality.mock.calls[0]![4] as Record<string, any>;
    expect(envelope['env:Envelope']['noa:NOA']['noa:ExchangedDeclaration']).toEqual({ 'ram:StatementTypeCode': 'ST-FI-01' });
  });

  it('refuses while the checklist has gaps, and after the ATA', async () => {
    const thin = harness({ snapshot: noaSnapshot({ notice: {} }) });
    const preview = await thin.service.noaPreview(ADMIN, 'pc-1');
    expect(preview.willSend).toBe(false);
    expect(preview.reason).toMatch(/Still missing: Primary purpose of call/);
    await expect(thin.service.sendNoa(ADMIN, 'pc-1', false)).rejects.toBeInstanceOf(BadRequestException);
    const moored = harness({ call: { nemo: { formalities: { ATA: { accepted: true } } } } });
    expect((await moored.service.noaPreview(ADMIN, 'pc-1')).reason).toMatch(/ATA/);
  });

  it('says what waits before the confirmation: the DUE', async () => {
    const { service } = harness();
    expect((await service.noaPreview(ADMIN, 'pc-1')).waitingForConfirm).toEqual(['DUE']);
  });
});

describe('the pre-arrival reports go with the NOA (spec 0098)', () => {
  const stores = {
    key: 'stores', header: {}, sources: [{ fileName: 'fal3.xlsx' }],
    rows: [{ key: '1', cells: { article: { value: 'STO-002' }, quantity: { value: '48' }, unit: { value: 'LTR' } } }],
  };
  const sentTypes = (nemo: { createFormality: jest.Mock }) => nemo.createFormality.mock.calls.map((c) => c[2]);

  it('a ticked report short of data holds the whole send (Data missing, user 2026-11-13)', async () => {
    const h = harness({ tables: [stores] });
    const preview = await h.service.noaPreview(ADMIN, 'pc-1');
    expect(preview.reports.find((r) => r.code === 'STA')).toMatchObject({ on: true, data: '1 article · from fal3.xlsx' });
    expect(preview.reports.find((r) => r.code === 'CWA')!.missing).toEqual(['the crew list (upload FAL 5 or the NSW crew list)']);
    await expect(h.service.sendNoa(ADMIN, 'pc-1', false)).rejects.toThrow(/Data missing in CWA/);
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
  });

  it('the ticked ready report goes after the NOA and the DUE once the ones without data are unticked', async () => {
    const h = harness({ tables: [stores], call: { nemo: { reports: offAll('CWA', 'EFF', 'WAS', 'SEC') } } });
    expect((await h.service.noaPreview(ADMIN, 'pc-1')).willSend).toBe(true);
    await h.service.sendNoa(ADMIN, 'pc-1', false);
    expect(sentTypes(h.nemo)).toEqual(['NOA', 'DUE', 'STA']);
    // its fact keeps the data's print, so an unchanged report is not sent again
    const facts = h.calls.filter((c) => c.sql.includes("'formalities'")).map((c) => JSON.parse(String(c.params![1])));
    expect(facts.find((f) => f.STA)!.STA.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('an unticked report is not sent', async () => {
    const h = harness({ tables: [stores], call: { nemo: { reports: offAll() } } });
    await h.service.sendNoa(ADMIN, 'pc-1', false);
    expect(sentTypes(h.nemo)).toEqual(['NOA', 'DUE']);
  });

  it('a tick is kept on the call and audited in the same transaction; an unbuilt report cannot be ticked', async () => {
    const h = harness({ tables: [stores] });
    await h.service.setReportChoice(ADMIN, 'pc-1', 'STA', false);
    const write = h.calls.find((c) => c.sql.includes("'reports'"))!;
    expect(JSON.parse(String(write.params![1]))).toEqual({ STA: { on: false, by: expect.any(String), at: expect.any(String) } });
    expect(h.content).toHaveBeenCalledWith(expect.objectContaining({ data: { action: 'nemo_report_choice', code: 'STA', on: false } }), expect.anything());
    await expect(h.service.setReportChoice(ADMIN, 'pc-1', 'PXA', true)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('one pre-arrival report on its own (spec 0098)', () => {
  const stores = {
    key: 'stores', header: {}, sources: [{ fileName: 'fal3.xlsx' }],
    rows: [{ key: '1', cells: { article: { value: 'STO-008' }, quantity: { value: '400' }, unit: { value: 'LTR' } } }],
  };
  const refusedSta = { STA: { formalityId: null, accepted: false, status: '8', errors: 1, version: 0, sentAt: '2026-10-06T13:00:00Z' } };

  it('a refused STA shows NEMO’s reasons from the audit chain and goes again alone, fixed', async () => {
    const h = harness({
      tables: [stores],
      call: { nemo: { formalities: refusedSta } },
      audit: [{ created: new Date('2026-10-06T13:00:00Z'), data: { accepted: false, words: 'ERR-027 Unit selection…', errors: [{ code: 'ERR-027', message: 'Unit selection…', path: null }] } }],
    });
    const p = await h.service.reportPreview(ADMIN, 'pc-1', 'STA');
    expect(p).toMatchObject({ willSend: true, reason: null, lastRefusal: { words: 'ERR-027 Unit selection…' } });
    // lubricants in litres go as m³ (NEMO's unit rule)
    const sta = p.envelope!['env:Envelope'] as Record<string, any>;
    expect(sta['sta:STA']['sta:SpecifiedLogisticsTransportMovement']['ram:OnboardStoresItemInventory'][0]['ram:OnboardMeasure']).toEqual({ $: 0.4, '@unitCode': 'MTQ' });
    await h.service.sendReport(ADMIN, 'pc-1', 'STA');
    expect(h.nemo.createFormality.mock.calls.map((c) => c[2])).toEqual(['STA']);
  });

  it('every other formality also goes alone: the NOA without its DUE, the DUE, the SID without the SHP', async () => {
    for (const code of ['NOA', 'DUE', 'SID'] as const) {
      const h = harness();
      const p = await h.service.reportPreview(ADMIN, 'pc-1', code);
      expect(p).toMatchObject({ code, willSend: true, reason: null });
      await h.service.sendReport(ADMIN, 'pc-1', code);
      expect(h.nemo.createFormality.mock.calls.map((c) => c[2])).toEqual([code]);
    }
  });

  it('a confirmed NOA sent again alone keeps its confirmation', async () => {
    const h = harness({ call: { nemo: { formalities: { NOA: { formalityId: 'outer-noa', accepted: true, version: 1, statement: 'ST-FI-01' } } } } });
    await h.service.sendReport(ADMIN, 'pc-1', 'NOA');
    const envelope = h.nemo.updateFormality.mock.calls[0]![4] as Record<string, any>;
    expect(envelope['env:Envelope']['noa:NOA']['noa:ExchangedDeclaration']).toEqual({ 'ram:StatementTypeCode': 'ST-FI-01' });
  });

  it('VID, ATA and ATD keep their own steps', async () => {
    const h = harness();
    for (const code of ['VID', 'ATA', 'ATD']) {
      await expect(h.service.reportPreview(ADMIN, 'pc-1', code)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('a report it does not build cannot be opened; SEC waits for the NOA', async () => {
    const h = harness({ tables: [stores] });
    await expect(h.service.reportPreview(ADMIN, 'pc-1', 'PXA')).rejects.toBeInstanceOf(BadRequestException);
    const noNoa = harness({ tables: [], snapshot: noaSnapshot({ submitted: ['VID'] }) });
    expect((await noNoa.service.reportPreview(ADMIN, 'pc-1', 'SEC')).reason).toBe('Send the NOA first — the security notice refers to it');
  });
});

describe('the visit check before every send (2026-10-06)', () => {
  const CANCELLED = [
    { formalityType: 'VID', status: 'INVALIDATED', formalityId: 'v-1' },
    { formalityType: 'COA', status: 'SUBMITTED', formalityId: 'c-1' },
  ];
  const REASON = 'Voyage cancelled (dummy)';

  it('visitCancelledIn: a COA in or the VID invalidated; withdrawn COA or live VID is not', () => {
    expect(visitCancelledIn(CANCELLED)).toBe(true);
    expect(visitCancelledIn([{ formalityType: 'VID', status: 'INVALIDATED' }])).toBe(true);
    expect(visitCancelledIn([{ formalityType: 'VID', status: 'SUBMITTED' }, { formalityType: 'COA', status: 'WITHDRAWN' }])).toBe(false);
    expect(visitCancelledIn(null)).toBe(false);
  });

  it('visitGoneHint: ERR-023, ERR-019 or OBJECT_NOT_FOUND', () => {
    const err = (code: string) => [{ code, message: null, path: null }];
    expect(visitGoneHint(err('ERR-023'), null)).toBe(true);
    expect(visitGoneHint(err('ERR-019'), null)).toBe(true);
    expect(visitGoneHint([], { errorKey: 'OBJECT_NOT_FOUND' })).toBe(true);
    expect(visitGoneHint(err('ERR-029'), { errorKey: 'BAD_REQUEST' })).toBe(false);
  });

  it('NEMO cancelled the visit: nothing is sent, the call is unlinked, every report says why', async () => {
    const h = harness({ nemo: { getFormalities: jest.fn(async () => CANCELLED) } });
    const receipt = await h.service.send(ADMIN, 'ship-1', 'pc-1');
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.nemo.updateFormality).not.toHaveBeenCalled();
    expect(receipt.results.length).toBeGreaterThan(0);
    for (const r of receipt.results) {
      expect(r).toMatchObject({ accepted: false, outcome: 'rejected', exchange: { headline: 'NEMO had cancelled FI20260925-013-0' } });
    }
    expect(h.calls.find((c) => c.sql.includes('visit_id = NULL'))?.sql).toContain('previousVisits');
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'nemo_visit_unlinked', visitId: 'FI20260925-013-0', reason: 'cancelled in NEMO' }) }),
      expect.anything(),
    );
  });

  it('NEMO not reached on the check: nothing is sent and nothing is unlinked', async () => {
    const h = harness({ nemo: { getFormalities: jest.fn().mockRejectedValue(new NemoApiError(503, '')) } });
    const receipt = await h.service.send(ADMIN, 'ship-1', 'pc-1');
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    for (const r of receipt.results) expect(r.outcome).toBe('unavailable');
    expect(h.calls.some((c) => c.sql.includes('visit_id = NULL'))).toBe(false);
  });

  it('cancel on a visit NEMO cancelled already: no COA goes, the call is unlinked, not cancelled here', async () => {
    const h = harness({ nemo: { getFormalities: jest.fn(async () => CANCELLED) } });
    await expect(h.service.cancel(ADMIN, 'pc-1', REASON)).resolves.toMatchObject({
      sent: false,
      exchange: { outcome: 'rejected', headline: 'NEMO had cancelled FI20260925-013-0' },
    });
    expect(h.nemo.createFormality).not.toHaveBeenCalled();
    expect(h.portCalls.cancel).not.toHaveBeenCalled();
    expect(h.calls.some((c) => c.sql.includes('visit_id = NULL'))).toBe(true);
  });

  it('a refusal with ERR-019 (out of sequence) looks again and unlinks when the visit is gone', async () => {
    const outOfSequence = JSON.stringify({
      frmResponse: { 'env:Envelope': { 'frm:FRM': { 'frm:AcknowledgementDocument': {
        'ram:StatusCode': '8',
        'ram:ReferencedReportedError': [{ 'ram:TypeCode': 'ERR-019', 'ram:Description': ['', 'The message has been received out of sequence.', ''] }],
      } } } },
      errorKey: 'OBJECT_NOT_FOUND',
    });
    const getFormalities = jest.fn().mockResolvedValueOnce([]).mockResolvedValue(CANCELLED);
    const h = harness({ nemo: { getFormalities, createFormality: jest.fn().mockRejectedValue(new NemoApiError(400, outOfSequence)) } });
    const receipt = await h.service.send(ADMIN, 'ship-1', 'pc-1');
    expect(getFormalities).toHaveBeenCalledTimes(2);
    expect(receipt.results[0]!.exchange.headline).toMatch(/NEMO had cancelled FI20260925-013-0/);
    expect(h.calls.some((c) => c.sql.includes('visit_id = NULL'))).toBe(true);
  });
});
