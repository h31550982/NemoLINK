/**
 * Spec 0052 — ingest envelope schema artifact: the published JSON Schema
 * must stay in lockstep with the zod door (shapes, required lists, vendored
 * enums, regexes), agree with zod on real envelopes under ajv 2020-12, and
 * the committed docs/integration artifact must equal the built schema.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { SHIP_TYPE_CODES } from '../src/canonical/generated/ship-type-codes';
import {
  CERTIFICATE_TYPE_CODES,
  ICE_CLASS_CODES,
  NAVIGATION_TYPE_CODES,
  iceClassSchema,
  shipCertificateSchema,
} from '../src/canonical/ship-master-data';
import {
  aisEventPayloadSchema,
  envelopeSchema,
  logEventPayloadSchema,
  nextPortSchema,
  planPayloadSchema,
  prevPortSchema,
  shipPayloadSchema,
  FI_LOCODE_RE,
  LOCODE_RE,
} from '../src/ingest/envelope.schema';
import {
  assertVersionBumped,
  buildIngestEnvelopeJsonSchema,
  INGEST_SCHEMA_FILENAME,
  INGEST_SCHEMA_VERSION,
} from '../src/ingest/envelope-json-schema';
import { IngestSchemaController } from '../src/ingest/ingest-schema.controller';

const ARTIFACT_PATH = join(
  __dirname,
  '..',
  '..',
  'docs',
  'integration',
  'ingest-envelope.schema.json',
);

/* eslint-disable @typescript-eslint/no-explicit-any */
const schema = buildIngestEnvelopeJsonSchema() as any;
const defs = schema.$defs;

const zodKeys = (shape: Record<string, z.ZodTypeAny>): string[] =>
  Object.keys(shape).sort();
const zodRequired = (shape: Record<string, z.ZodTypeAny>): string[] =>
  Object.keys(shape)
    .filter((k) => !shape[k]!.isOptional())
    .sort();
const defKeys = (def: any): string[] => Object.keys(def.properties).sort();
const defRequired = (def: any): string[] => [...(def.required ?? [])].sort();

describe('version', () => {
  it('appears in $id, the version keyword and the filename', () => {
    expect(schema.version).toBe(INGEST_SCHEMA_VERSION);
    expect(schema.$id).toBe(`urn:nemolink:ingest-envelope:${INGEST_SCHEMA_VERSION}`);
    expect(INGEST_SCHEMA_FILENAME).toBe(
      `nemolink-ingest-envelope-v${INGEST_SCHEMA_VERSION}.schema.json`,
    );
  });

  it('regen guard: content change without a bump throws, with a bump passes', () => {
    const built = buildIngestEnvelopeJsonSchema();
    const stale = JSON.parse(JSON.stringify(built)) as Record<string, unknown>;
    (stale['$defs'] as any).planPayload.properties.extra = { type: 'string' };
    expect(() => assertVersionBumped(stale, built)).toThrow(/INGEST_SCHEMA_VERSION/);
    stale['version'] = '0.0.0-older';
    expect(() => assertVersionBumped(stale, built)).not.toThrow();
    expect(() => assertVersionBumped(built, built)).not.toThrow();
  });
});

describe('lockstep with the zod door', () => {
  const variantByType: Record<string, any> = {
    plan: defs.planEnvelope,
    'log-event': defs.logEventEnvelope,
    // Spec 0095 — actuals derived from AIS, their own lane
    'ais-event': defs.aisEventEnvelope,
    ship: defs.shipEnvelope,
    // Spec 0055 — the one variant with no ship: it is about calls
    manifest: defs.manifestEnvelope,
  };

  it('covers every envelope variant with matching properties and required lists', () => {
    expect(envelopeSchema.options).toHaveLength(Object.keys(variantByType).length);
    expect(schema.oneOf).toHaveLength(envelopeSchema.options.length);
    for (const option of envelopeSchema.options) {
      const payloadType = option.shape.payloadType.value;
      const def = variantByType[payloadType];
      expect(def).toBeDefined();
      expect(def.properties.payloadType.const).toBe(payloadType);
      expect(defKeys(def)).toEqual(zodKeys(option.shape));
      expect(defRequired(def)).toEqual(zodRequired(option.shape));
      expect(def.additionalProperties).toBe(false);
    }
  });

  it('mirrors the ship reference and the port-call hint', () => {
    const base = envelopeSchema.options[0]!.shape;
    expect(defKeys(defs.ship)).toEqual(zodKeys(base.ship.shape));
    expect(defRequired(defs.ship)).toEqual(zodRequired(base.ship.shape));
    const hint = base.portCallHint.unwrap();
    expect(defKeys(defs.portCallHint)).toEqual(zodKeys(hint.shape));
    expect(defRequired(defs.portCallHint)).toEqual(zodRequired(hint.shape));
  });

  it('mirrors the plan and log-event payloads and the rotation legs', () => {
    const pairs: Array<[any, z.AnyZodObject]> = [
      [defs.planPayload, planPayloadSchema],
      [defs.logEventPayload, logEventPayloadSchema],
      [defs.aisEventPayload, aisEventPayloadSchema],
      [defs.prevPort, prevPortSchema],
      [defs.nextPort, nextPortSchema],
      [defs.iceClass, iceClassSchema],
      [defs.shipCertificate, shipCertificateSchema],
    ];
    for (const [def, zodObject] of pairs) {
      expect(defKeys(def)).toEqual(zodKeys(zodObject.shape));
      expect(defRequired(def)).toEqual(zodRequired(zodObject.shape));
      expect(def.additionalProperties).toBe(false);
    }
  });

  it('mirrors the ship payload, including the at-least-one-field rule', () => {
    const shape = shipPayloadSchema.innerType().shape;
    expect(defKeys(defs.shipPayload)).toEqual(zodKeys(shape));
    expect(defRequired(defs.shipPayload)).toEqual([]);
    expect(defs.shipPayload.minProperties).toBe(1);
    expect(defs.shipPayload.additionalProperties).toBe(false);
  });

  it('carries the vendored enums and regexes verbatim', () => {
    expect(defs.shipCertificate.properties.typeCode.enum).toEqual(
      [...CERTIFICATE_TYPE_CODES].sort(),
    );
    expect(defs.iceClass.properties.code.enum).toEqual([...ICE_CLASS_CODES].sort());
    expect(defs.shipPayload.properties.navigationTypeCode.enum).toEqual(
      [...NAVIGATION_TYPE_CODES].sort(),
    );
    expect(defs.shipPayload.properties.typeCode.enum).toEqual(
      [...SHIP_TYPE_CODES].sort(),
    );
    expect(defs.logEventPayload.properties.event.enum).toEqual(['ata', 'atd']);
    expect(defs.locode.pattern).toBe(LOCODE_RE.source);
    expect(defs.fiLocode.pattern).toBe(FI_LOCODE_RE.source);
  });
});

describe('agreement between zod and the JSON Schema (ajv 2020-12)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addKeyword({ keyword: 'version' });
  addFormats(ajv);
  const validate = ajv.compile(buildIngestEnvelopeJsonSchema());

  const certType = [...CERTIFICATE_TYPE_CODES].sort()[0]!;
  const iceCode = [...ICE_CLASS_CODES].sort()[0]!;
  const navCode = [...NAVIGATION_TYPE_CODES].sort()[0]!;
  const shipType = [...SHIP_TYPE_CODES].sort()[0]!;

  const base = {
    sourceSystem: 'nextvoy',
    eventId: 'evt-1',
    occurredAt: '2026-08-23T10:00:00Z',
    ship: { imoNumber: '9387425', name: 'MS Test' },
  };
  const plan = {
    ...base,
    payloadType: 'plan',
    payload: {
      sourceCallId: '4f2b8f9c-1d2e-4a5b-8c7d-9e0f1a2b3c4d',
      portLocode: 'FIKOK',
      eta: '2026-08-25T07:30:00+03:00',
      voyageNumber: 'V-118',
      cargoDescription: 'Sawn timber',
      prevPorts: [{ portLocode: 'SEGOT', departure: '2026-08-23T18:00:00Z' }],
      nextPorts: [{ portLocode: 'DEHAM', eta: '2026-08-29T06:00:00Z' }],
    },
  };
  const logEvent = {
    ...base,
    sourceSystem: 'log',
    payloadType: 'log-event',
    portCallHint: { voyageNumber: 'V-118' },
    payload: { event: 'ata', timestamp: '2026-08-25T06:58:00Z', portLocode: 'FIKOK' },
  };
  const aisEvent = {
    ...base,
    sourceSystem: 'ais',
    payloadType: 'ais-event',
    payload: {
      event: 'ata',
      timestamp: '2026-08-25T06:58:00Z',
      portLocode: 'FIKOK',
      berth: 'FIKOK-BB-BB1',
      position: { latitude: 63.8431, longitude: 23.0336 },
    },
  };
  const shipPush = {
    ...base,
    sourceSystem: 'registry',
    payloadType: 'ship',
    payload: {
      flagState: 'FI',
      length: 158.6,
      typeCode: shipType,
      navigationTypeCode: navCode,
      buildDate: '2005-04-01',
      inertGasSystem: true,
      mainEnginePower: 9600,
      iceClass: { code: iceCode, validTo: '2027-01-01' },
      certificates: [{ typeCode: certType, expiryDate: '2027-05-01' }],
    },
  };

  const cases: Array<[string, unknown, boolean]> = [
    ['plan envelope with rotation', plan, true],
    ['log-event envelope with hint', logEvent, true],
    ['ais-event envelope with berth and position (spec 0095)', aisEvent, true],
    ['minimal ais-event', { ...aisEvent, payload: { event: 'atd', timestamp: '2026-08-26T18:00:00Z' } }, true],
    ['ais-event latitude out of range', { ...aisEvent, payload: { ...aisEvent.payload, position: { latitude: 91, longitude: 0 } } }, false],
    ['ais-event position without longitude', { ...aisEvent, payload: { ...aisEvent.payload, position: { latitude: 60 } } }, false],
    ['ais-event unknown key', { ...aisEvent, payload: { ...aisEvent.payload, speed: 0.1 } }, false],
    ['ship master-data envelope', shipPush, true],
    ['minimal ship payload', { ...shipPush, payload: { operatorName: 'Bore' } }, true],
    ['plan with purposes of call (spec 0090)', { ...plan, payload: { ...plan.payload, callPurposes: ['17', '16'] } }, true],
    ['purpose not in NEMO codes', { ...plan, payload: { ...plan.payload, callPurposes: ['2 Loading'] } }, false],
    ['empty purposes', { ...plan, payload: { ...plan.payload, callPurposes: [] } }, false],
    ['unknown root key', { ...plan, extra: 1 }, false],
    ['unknown payload key', { ...plan, payload: { ...plan.payload, extra: 1 } }, false],
    ['six-digit IMO', { ...plan, ship: { imoNumber: '123456', name: 'MS Test' } }, false],
    ['non-FI plan locode', { ...plan, payload: { ...plan.payload, portLocode: 'SEGOT' } }, false],
    [
      'plan without sourceCallId',
      { ...plan, payload: { portLocode: 'FIKOK', eta: '2026-08-25T07:30:00Z' } },
      false,
    ],
    ['empty ship payload', { ...shipPush, payload: {} }, false],
    ['null ship field', { ...shipPush, payload: { flagState: null } }, false],
    ['unaccepted payloadType', { ...plan, payloadType: 'ship-doc' }, false],
    [
      'log event outside the enum',
      { ...logEvent, payload: { event: 'eta', timestamp: '2026-08-25T06:58:00Z' } },
      false,
    ],
    ['date-only occurredAt', { ...plan, occurredAt: '2026-08-23' }, false],
    ['uppercase sourceSystem', { ...plan, sourceSystem: 'Nextvoy' }, false],
  ];

  it.each(cases)('%s', (_name, value, valid) => {
    expect(envelopeSchema.safeParse(value).success).toBe(valid);
    expect(validate(value)).toBe(valid);
  });
});

describe('admin download endpoint', () => {
  it('serves the schema with the versioned attachment filename', () => {
    const headers: Record<string, string> = {};
    let sent = '';
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      send: (body: string) => {
        sent = body;
      },
    };
    new IngestSchemaController().download(res as never);
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="${INGEST_SCHEMA_FILENAME}"`,
    );
    expect(headers['Content-Type']).toContain('json');
    expect(JSON.parse(sent)).toEqual(schema);
  });

  it('meta names the current version and filename', () => {
    expect(new IngestSchemaController().meta()).toEqual({
      version: INGEST_SCHEMA_VERSION,
      filename: INGEST_SCHEMA_FILENAME,
    });
  });
});
