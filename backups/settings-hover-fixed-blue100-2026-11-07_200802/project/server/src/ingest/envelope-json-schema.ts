/**
 * The published mirror of the ingest envelope (docs/specs/0052): a JSON
 * Schema (draft 2020-12) built from the same vendored enum sets, field
 * lists and regexes the zod schema validates with — zod stays the runtime
 * authority, this artifact exists for upstream integrators. Any change to
 * envelope.schema.ts or the ship master-data wire model must be mirrored
 * here, INGEST_SCHEMA_VERSION bumped, and the committed artifact
 * regenerated (`npm run gen:ingest-schema`); the ingest-schema jest suite
 * enforces all three.
 */

import { SHIP_TYPE_CODES } from '../canonical/generated/ship-type-codes';
import {
  CALL_PURPOSE_CODES,
  CERTIFICATE_TYPE_CODES,
  ICE_CLASS_CODES,
  NAVIGATION_TYPE_CODES,
  SHIP_DATA_NUMBER_FIELDS,
  SHIP_DATA_STRING_FIELDS,
} from '../canonical/ship-master-data';
import { FI_LOCODE_RE, LOCODE_RE } from './envelope.schema';

export const INGEST_SCHEMA_VERSION = '1.7.0';

export const INGEST_SCHEMA_FILENAME = `nemolink-ingest-envelope-v${INGEST_SCHEMA_VERSION}.schema.json`;

type Json = Record<string, unknown>;

const enumOf = (codes: ReadonlySet<string>): string[] => [...codes].sort();

/** z.string().min(1).max(200) — the house free-text string. */
const str = (): Json => ({ type: 'string', minLength: 1, maxLength: 200 });

const isoDate = (): Json => ({ $ref: '#/$defs/isoDate' });

function particularsProperties(): Json {
  const props: Json = {};
  for (const key of Object.keys(SHIP_DATA_STRING_FIELDS)) {
    props[key] =
      key === 'navigationTypeCode'
        ? {
            type: 'string',
            enum: enumOf(NAVIGATION_TYPE_CODES),
            description: 'Type of navigation (vendored NEMO codelist)',
          }
        : str();
  }
  for (const key of Object.keys(SHIP_DATA_NUMBER_FIELDS)) {
    props[key] = { type: 'number' };
  }
  props['typeCode'] = {
    type: 'string',
    enum: enumOf(SHIP_TYPE_CODES),
    description: 'Ship type (vendored NEMO codelist)',
  };
  props['mainEngineAvailabilityIndicator'] = { type: 'boolean' };
  props['buildDate'] = isoDate();
  props['keelLayingDate'] = isoDate();
  props['inertGasSystem'] = { type: 'boolean' };
  props['mainEnginePower'] = {
    type: 'number',
    description: 'Kilowatts (stored with UN/ECE Rec 20 unit KWT)',
  };
  props['iceClass'] = { $ref: '#/$defs/iceClass' };
  props['certificates'] = {
    type: 'array',
    maxItems: 100,
    items: { $ref: '#/$defs/shipCertificate' },
    description:
      'Ship certificates — sent as the complete set: the array replaces all previously stored certificates',
  };
  return props;
}

function envelopeVariant(
  payloadType: 'plan' | 'log-event' | 'ais-event' | 'ship',
  payloadRef: string,
  description: string,
): Json {
  return {
    type: 'object',
    description,
    properties: {
      sourceSystem: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_-]*$',
        maxLength: 50,
        description:
          "Lowercase identifier of the sending system — must equal the ingest credential's source system",
      },
      eventId: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description:
          'The dedupe key: a (sourceSystem, eventId) pair is applied at most once per organization; re-sends answer status "duplicate"',
      },
      occurredAt: {
        $ref: '#/$defs/isoDateTime',
        description:
          'When the source observed/emitted this. An envelope older than the last applied one of its payload type is archived but not applied (status "stale")',
      },
      ship: { $ref: '#/$defs/ship' },
      portCallHint: { $ref: '#/$defs/portCallHint' },
      payloadType: { const: payloadType },
      payload: { $ref: payloadRef },
    },
    required: ['sourceSystem', 'eventId', 'occurredAt', 'ship', 'payloadType', 'payload'],
    additionalProperties: false,
  };
}

/** Regen guard (spec 0052): a content change requires a version bump. */
export function assertVersionBumped(committed: Json, built: Json): void {
  const strip = ({ $id: _$id, version: _version, ...rest }: Json): Json => rest;
  const changed =
    JSON.stringify(strip(committed)) !== JSON.stringify(strip(built));
  if (changed && committed['version'] === built['version']) {
    throw new Error(
      'Ingest schema content changed but INGEST_SCHEMA_VERSION did not — bump it ' +
        'in server/src/ingest/envelope-json-schema.ts, then rerun `npm run gen:ingest-schema`',
    );
  }
}

export function buildIngestEnvelopeJsonSchema(): Json {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `urn:nemolink:ingest-envelope:${INGEST_SCHEMA_VERSION}`,
    title: 'NEMOLink ingest envelope',
    version: INGEST_SCHEMA_VERSION,
    description:
      'One envelope per push to POST /api/v1/ingest, authenticated with a per-source ' +
      'ingest credential (Authorization: Bearer). The ship must exist as active master ' +
      'data in the organization: a plan, log-event or ais-event envelope for an unknown IMO is ' +
      'rejected (422 unknown_ship). A ship envelope for an unknown IMO creates the ship ' +
      'when the credential is allowed to register its fleet, and is rejected otherwise; ' +
      'an inactive ship is never reactivated by a push (422 inactive_ship). Unknown keys ' +
      'anywhere are rejected with field pointers. Responses: 201 when a port call or a ' +
      'ship was created; otherwise 200 with the outcome status (updated, duplicate, ' +
      'stale, swept, held, …).',
    oneOf: [
      { $ref: '#/$defs/planEnvelope' },
      { $ref: '#/$defs/logEventEnvelope' },
      { $ref: '#/$defs/aisEventEnvelope' },
      { $ref: '#/$defs/shipEnvelope' },
      { $ref: '#/$defs/manifestEnvelope' },
    ],
    $defs: {
      isoDateTime: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 date-time with timezone (Z or ±hh:mm)',
      },
      isoDate: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Date as yyyy-mm-dd',
      },
      locode: {
        type: 'string',
        pattern: LOCODE_RE.source,
        description: 'UN/LOCODE (e.g. FIHEL)',
      },
      fiLocode: {
        type: 'string',
        pattern: FI_LOCODE_RE.source,
        description:
          'Finnish UN/LOCODE (FI···) — NEMO declares Finnish port calls; previous/next ports belong in the itinerary',
      },
      ship: {
        type: 'object',
        properties: {
          imoNumber: {
            type: 'string',
            pattern: '^\\d{7}$',
            description:
              'The hard ship identity — must match an active ship in the organization. ' +
              'Seven digits whose seventh is the IMO check digit (the first six weighted 7…2, ' +
              'summed, modulo 10); a number that fails it is refused (spec 0077)',
          },
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'Ship name as the source knows it, for audit readability — a mismatch with the registered name warns, never rejects',
          },
          mmsi: {
            type: 'string',
            pattern: '^\\d{9}$',
            description:
              'MMSI as the source knows it — a ship envelope sets it on the ship record (create and update); plan, log-event and ais-event envelopes ignore it',
          },
          callSign: {
            type: 'string',
            minLength: 1,
            maxLength: 20,
            description:
              'Radio call sign — a ship envelope sets it on the ship record (create and update); plan, log-event and ais-event envelopes ignore it',
          },
        },
        required: ['imoNumber', 'name'],
        additionalProperties: false,
      },
      portCallHint: {
        type: 'object',
        description:
          'Optional addressing help for matching the port call; sources that know the NEMOLink portCallId skip matching entirely',
        properties: {
          portCallId: { type: 'string', format: 'uuid', description: 'NEMOLink port-call UUID' },
          visitId: { type: 'string', minLength: 1, maxLength: 50 },
          voyageNumber: { type: 'string', minLength: 1, maxLength: 50 },
        },
        additionalProperties: false,
      },
      prevPort: {
        type: 'object',
        description: 'One earlier leg of the rotation — most recent first',
        properties: {
          portLocode: { $ref: '#/$defs/locode' },
          arrival: { $ref: '#/$defs/isoDateTime' },
          departure: { $ref: '#/$defs/isoDateTime' },
        },
        required: ['portLocode'],
        additionalProperties: false,
      },
      nextPort: {
        type: 'object',
        description: 'One upcoming leg — next first',
        properties: {
          portLocode: { $ref: '#/$defs/locode' },
          eta: { $ref: '#/$defs/isoDateTime' },
          etd: { $ref: '#/$defs/isoDateTime' },
        },
        required: ['portLocode'],
        additionalProperties: false,
      },
      planPayload: {
        type: 'object',
        description: 'Chartering-side voyage plan',
        properties: {
          sourceCallId: {
            type: 'string',
            format: 'uuid',
            description:
              "The SOURCE system's own UUID for the call — re-sends of the same voyage update the same port call via (sourceSystem, sourceCallId)",
          },
          portLocode: { $ref: '#/$defs/fiLocode' },
          eta: { $ref: '#/$defs/isoDateTime' },
          etd: { $ref: '#/$defs/isoDateTime' },
          voyageNumber: { type: 'string', minLength: 1, maxLength: 50 },
          cargoDescription: { type: 'string', maxLength: 2000 },
          callPurposes: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: { type: 'string', enum: [...CALL_PURPOSE_CODES] },
            description:
              "Why the ship calls, in NEMO's purpose of call codes (UN/EDIFACT 8025, the NOA's DE-014-10: 17 loading cargo, 16 unloading cargo, 7 repair, …). The source system's integration maps its own call types",
          },
          prevPorts: { type: 'array', maxItems: 10, items: { $ref: '#/$defs/prevPort' } },
          nextPorts: { type: 'array', maxItems: 10, items: { $ref: '#/$defs/nextPort' } },
        },
        required: ['sourceCallId', 'portLocode'],
        additionalProperties: false,
      },
      logEventPayload: {
        type: 'object',
        description:
          'Verified actuals from the elog chain — applied as operator-confirmed suggestions',
        properties: {
          event: { type: 'string', enum: ['ata', 'atd'] },
          timestamp: { $ref: '#/$defs/isoDateTime' },
          portLocode: { $ref: '#/$defs/locode' },
        },
        required: ['event', 'timestamp'],
        additionalProperties: false,
      },
      aisEventPayload: {
        type: 'object',
        description:
          'An actual from AIS (spec 0095) — derived from positions, it ranks below the logbook; applied as an operator-confirmed suggestion',
        properties: {
          event: { type: 'string', enum: ['ata', 'atd'] },
          timestamp: { $ref: '#/$defs/isoDateTime' },
          portLocode: { $ref: '#/$defs/locode' },
          berth: {
            type: 'string',
            minLength: 1,
            maxLength: 70,
            description: 'The berth or quay the geofence names — shown to the operator, not sent to NEMO',
          },
          position: {
            type: 'object',
            description: 'Where the ship was at the timestamp — shown to the operator, not sent to NEMO',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
            },
            required: ['latitude', 'longitude'],
            additionalProperties: false,
          },
        },
        required: ['event', 'timestamp'],
        additionalProperties: false,
      },
      iceClass: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            enum: enumOf(ICE_CLASS_CODES),
            description: 'Ice class (vendored NEMO codelist)',
          },
          status: { type: 'string', minLength: 1, maxLength: 50 },
          entryDate: isoDate(),
          validTo: isoDate(),
          dateOfIssue: isoDate(),
        },
        required: ['code'],
        additionalProperties: false,
      },
      shipCertificate: {
        type: 'object',
        properties: {
          typeCode: {
            type: 'string',
            enum: enumOf(CERTIFICATE_TYPE_CODES),
            description: 'Certificate type (vendored NEMO codelist)',
          },
          certificateId: { type: 'string', minLength: 1, maxLength: 64 },
          issueDate: isoDate(),
          expiryDate: isoDate(),
          extendedUntil: isoDate(),
          description: { type: 'string', minLength: 1, maxLength: 200 },
          issuer: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Certificate issuer name (DE-006-09)',
          },
          issuerTypeCode: {
            type: 'string',
            minLength: 1,
            maxLength: 32,
            description: 'Certificate issuer type (DE-006-06, IMO Compendium)',
          },
          issuerId: {
            type: 'string',
            minLength: 1,
            maxLength: 32,
            description: 'Certificate issuer, coded (DE-006-08, NEMO certificate-issuer list)',
          },
          issuerCountry: {
            type: 'string',
            pattern: '^[A-Z]{2}$',
            description: "Certificate issuer's flag state (DE-006-07, ISO 3166-1 alpha-2)",
          },
        },
        required: ['typeCode'],
        additionalProperties: false,
      },
      shipPayload: {
        type: 'object',
        description:
          'Ship master data — send only the fields the source knows: omitted fields keep ' +
          'their stored value, null is never accepted (clearing a field is an admin act)',
        properties: particularsProperties(),
        minProperties: 1,
        additionalProperties: false,
      },
      planEnvelope: envelopeVariant(
        'plan',
        '#/$defs/planPayload',
        'Voyage plan push — creates or updates a port call',
      ),
      logEventEnvelope: envelopeVariant(
        'log-event',
        '#/$defs/logEventPayload',
        'Arrival/departure actual from the elog chain',
      ),
      aisEventEnvelope: envelopeVariant(
        'ais-event',
        '#/$defs/aisEventPayload',
        'Arrival/departure actual derived from AIS (spec 0095)',
      ),
      shipEnvelope: envelopeVariant(
        'ship',
        '#/$defs/shipPayload',
        'Ship master-data push — particulars and/or certificates',
      ),
      manifestEntry: {
        type: 'object',
        description:
          'One call the source holds. "sent" was pushed as a plan envelope; ' +
          '"withheld" still exists at the source but did not qualify to be ' +
          'pushed, and must say why. A call the source holds but omits here ' +
          'is treated as deleted.',
        properties: {
          sourceCallId: {
            type: 'string',
            format: 'uuid',
            description: "The source system's own UUID for the call",
          },
          disposition: { enum: ['sent', 'withheld'] },
          reason: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description:
              'Why a withheld call did not travel, e.g. "transit", ' +
              '"status:Planned", "inactive-ship". Required when withheld.',
          },
        },
        required: ['sourceCallId', 'disposition'],
        additionalProperties: false,
      },
      manifestPayload: {
        type: 'object',
        description:
          'What the source holds for one window — a completeness statement, ' +
          'not content. Send it ONLY after a clean, complete run: a partial ' +
          'run must send none, because absence inside a manifest is read as ' +
          'deletion. Calls with no ETA are never swept. A manifest that would ' +
          'remove more than a fifth of the calls it covers is held for an ' +
          'administrator and changes nothing (status "held").',
        properties: {
          scope: { const: 'port-calls' },
          windowFrom: { $ref: '#/$defs/isoDateTime' },
          windowTo: {
            $ref: '#/$defs/isoDateTime',
            description: 'Must be after windowFrom; the window is [from, to)',
          },
          entries: {
            type: 'array',
            maxItems: 5000,
            items: { $ref: '#/$defs/manifestEntry' },
            description: 'Every call the source holds in the window, once each',
          },
        },
        required: ['scope', 'windowFrom', 'windowTo', 'entries'],
        additionalProperties: false,
      },
      manifestEnvelope: {
        type: 'object',
        description:
          'Completeness statement for a window, so a call deleted at the ' +
          'source can be noticed. Carries no ship — it is about calls.',
        properties: {
          sourceSystem: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_-]*$',
            maxLength: 50,
            description:
              "Lowercase identifier of the sending system — must equal the ingest credential's source system",
          },
          eventId: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'The dedupe key: a (sourceSystem, eventId) pair is applied at most once per organization; re-sends answer status "duplicate"',
          },
          occurredAt: { $ref: '#/$defs/isoDateTime' },
          payloadType: { const: 'manifest' },
          payload: { $ref: '#/$defs/manifestPayload' },
        },
        required: ['sourceSystem', 'eventId', 'occurredAt', 'payloadType', 'payload'],
        additionalProperties: false,
      },
    },
  };
}
