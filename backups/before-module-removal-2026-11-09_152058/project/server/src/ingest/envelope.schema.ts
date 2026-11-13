/**
 * The standard ingestion envelope (docs/02 §Ingestion, docs/specs/0026) —
 * camelCase at the API edge, zod-strict throughout: unknown keys are
 * rejected with field pointers, submitted values are never echoed into logs
 * (invariant 3).
 *
 * v5 accepts payload types 'plan', 'log-event', 'ais-event' (the actuals
 * from AIS, spec 0095), 'ship' (ship master data, spec 0036) and
 * 'manifest' (what the source holds for a window, so a deletion can be
 * noticed — spec 0055); 'ship-doc' joins with the Phase-2 declaration
 * specs, where its lane documents have somewhere to live.
 *
 * KEEP THE PUBLISHED MIRROR IN LOCKSTEP (spec 0052): any change here must
 * be mirrored in envelope-json-schema.ts, INGEST_SCHEMA_VERSION bumped,
 * and the artifact regenerated (`npm run gen:ingest-schema`) — the
 * ingest-schema jest suite fails otherwise.
 */

import { z } from 'zod';
import { imoNumberSchema } from '../canonical/imo';
import {
  CALL_PURPOSE_CODES,
  shipCertificateSchema,
  shipParticularsSchema,
} from '../canonical/ship-master-data';

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 date-time');

export const LOCODE_RE = /^[A-Z]{2}[A-Z2-9]{3}$/;
const locode = z.string().regex(LOCODE_RE, 'must be a UN/LOCODE (e.g. FIHEL)');

/** NEMO declares Finnish port calls only (spec 0037). */
export const FI_LOCODE_RE = /^FI[A-Z2-9]{3}$/;
export const fiLocode = z
  .string()
  .regex(
    FI_LOCODE_RE,
    'must be a Finnish UN/LOCODE (FI···) — NEMO declares Finnish port calls; previous/next ports belong in the itinerary',
  );

/** One earlier leg of the rotation — most recent first (spec 0037). */
export const prevPortSchema = z
  .object({
    portLocode: locode,
    arrival: isoDateTime.optional(),
    departure: isoDateTime.optional(),
  })
  .strict();

/** One upcoming leg — next first. */
export const nextPortSchema = z
  .object({
    portLocode: locode,
    eta: isoDateTime.optional(),
    etd: isoDateTime.optional(),
  })
  .strict();

export type PrevPort = z.infer<typeof prevPortSchema>;
export type NextPort = z.infer<typeof nextPortSchema>;

/**
 * Chartering-side voyage plan — the plan lane's domain (docs/03).
 * sourceCallId is the SOURCE system's own UUID for the call (spec 0034):
 * we never mint identity for external systems, and re-sends of the same
 * voyage update the same call via (sourceSystem, sourceCallId).
 * prevPorts/nextPorts carry the rotation for NOA route + SEC last-ports
 * pre-fill (spec 0037) — max 10 each per the National Spreadsheet.
 */
export const planPayloadSchema = z
  .object({
    sourceCallId: z.string().uuid(),
    portLocode: fiLocode,
    eta: isoDateTime.optional(),
    etd: isoDateTime.optional(),
    voyageNumber: z.string().min(1).max(50).optional(),
    cargoDescription: z.string().max(2000).optional(),
    // Why the ship calls, in NEMO's codes: the source's integration maps its own
    // call types (spec 0090); NEMOLink's ingest stays in the standard
    callPurposes: z
      .array(z.string().refine((c) => CALL_PURPOSE_CODES.has(c), 'Not a NEMO purpose of call (UN/EDIFACT 8025)'))
      .min(1)
      .max(10)
      .optional(),
    prevPorts: z.array(prevPortSchema).max(10).optional(),
    nextPorts: z.array(nextPortSchema).max(10).optional(),
  })
  .strict();

/** Verified actuals from the elog chain — the log lane's domain. */
export const logEventPayloadSchema = z
  .object({
    event: z.enum(['ata', 'atd']),
    timestamp: isoDateTime,
    portLocode: locode.optional(),
  })
  .strict();

/**
 * An actual from AIS (spec 0095) — the ais lane: derived from positions (a
 * geofence, the navigational status), so it ranks below the logbook. The
 * berth and the position help the operator judge the time; neither goes to
 * NEMO.
 */
export const aisEventPayloadSchema = z
  .object({
    event: z.enum(['ata', 'atd']),
    timestamp: isoDateTime,
    portLocode: locode.optional(),
    berth: z.string().min(1).max(70).optional(),
    position: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Ship master data (spec 0036): the particulars wire model + certificate
 * array (whole-set replace, spec 0020 semantics). Sources send what they
 * know — nulls are rejected (clearing is an admin act), and an empty
 * payload is meaningless.
 */
export const shipPayloadSchema = shipParticularsSchema
  .extend({
    certificates: z.array(shipCertificateSchema).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field is required',
      });
    }
    for (const [key, v] of entries) {
      if (v === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'null is not allowed — omit fields the source does not know',
        });
      }
    }
  });

/**
 * A completeness statement, not content (spec 0055). opsDesk hard-deletes port
 * calls and has no cancelled status, so a delta push can never see a call go
 * away. The manifest reports what the source holds for a window, which turns
 * "we heard nothing" — indistinguishable from a crashed run — into an explicit
 * fact. `withheld` means the call still exists but no longer qualifies to be
 * pushed (transit, unconfirmed, inactive ship); omission means it is gone.
 */
export const manifestEntrySchema = z
  .object({
    sourceCallId: z.string().uuid(),
    disposition: z.enum(['sent', 'withheld']),
    // Why it did not travel — 'transit', 'status:Planned', 'inactive-ship'.
    reason: z.string().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.disposition === 'withheld' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message:
          'a withheld call must say why — an unexplained absence is what this payload exists to prevent',
      });
    }
  });

export const manifestPayloadSchema = z
  .object({
    scope: z.literal('port-calls'),
    windowFrom: isoDateTime,
    windowTo: isoDateTime,
    entries: z.array(manifestEntrySchema).max(5000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.windowTo) <= Date.parse(value.windowFrom)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowTo'],
        message: 'windowTo must be after windowFrom',
      });
    }
    const seen = new Set<string>();
    for (const [index, entry] of value.entries.entries()) {
      if (seen.has(entry.sourceCallId)) {
        // A call that is both sent and withheld states nothing at all, and
        // this payload's whole value is that it is unambiguous.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'sourceCallId'],
          message: 'duplicate sourceCallId in the manifest',
        });
      }
      seen.add(entry.sourceCallId);
    }
  });

const envelopeBase = {
  sourceSystem: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, 'lowercase identifier')
    .max(50),
  eventId: z.string().min(1).max(200),
  occurredAt: isoDateTime,
  // Name is required for audit readability (spec 0034); IMO stays the
  // hard identity — a name mismatch warns, never rejects.
  ship: z
    .object({
      // Seven digits and the check digit (spec 0077) — refused as NEMO would refuse it
      imoNumber: imoNumberSchema,
      name: z.string().min(1).max(200),
      // Identity the source also knows (spec 0060 amendment): set on the
      // ship row by a `ship` envelope — on create and on update — and
      // ignored by plan, log-event and ais-event envelopes.
      mmsi: z.string().regex(/^\d{9}$/).optional(),
      callSign: z.string().min(1).max(20).optional(),
    })
    .strict(),
  portCallHint: z
    .object({
      // Our port-call UUID, for addressed sources that know it (the
      // ship UI does; the logbook does not) — skips matching entirely.
      portCallId: z.string().uuid().optional(),
      visitId: z.string().min(1).max(50).optional(),
      voyageNumber: z.string().min(1).max(50).optional(),
    })
    .strict()
    .optional(),
};

export const envelopeSchema = z.discriminatedUnion('payloadType', [
  z.object({ ...envelopeBase, payloadType: z.literal('plan'), payload: planPayloadSchema }).strict(),
  z
    .object({ ...envelopeBase, payloadType: z.literal('log-event'), payload: logEventPayloadSchema })
    .strict(),
  z
    .object({ ...envelopeBase, payloadType: z.literal('ais-event'), payload: aisEventPayloadSchema })
    .strict(),
  z
    .object({ ...envelopeBase, payloadType: z.literal('ship'), payload: shipPayloadSchema })
    .strict(),
  // No `ship`: a manifest is about calls, not a vessel (spec 0055).
  z
    .object({
      sourceSystem: envelopeBase.sourceSystem,
      eventId: envelopeBase.eventId,
      occurredAt: envelopeBase.occurredAt,
      payloadType: z.literal('manifest'),
      payload: manifestPayloadSchema,
    })
    .strict(),
]);

export type IngestEnvelope = z.infer<typeof envelopeSchema>;
export type PlanPayload = z.infer<typeof planPayloadSchema>;
export type LogEventPayload = z.infer<typeof logEventPayloadSchema>;
export type AisEventPayload = z.infer<typeof aisEventPayloadSchema>;
export type ShipPayload = z.infer<typeof shipPayloadSchema>;
export type ManifestPayload = z.infer<typeof manifestPayloadSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type ManifestEnvelope = Extract<IngestEnvelope, { payloadType: 'manifest' }>;
