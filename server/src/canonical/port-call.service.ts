/**
 * Canonical port-call spine (docs/specs/0026, reshaped by 0034).
 *
 * The port call is the BASE RECORD: created by the owning plan system
 * (identity = the source's own UUID, upsert on (source, source_call_id))
 * or manually by an org admin. The owning system maintains the base
 * fields (port, eta/etd, voyage, cargo — auto-applied); everything
 * ship/log-side lands as a SUGGESTION in data.suggestions that only an
 * operator's confirm action turns into an actual + status change —
 * nothing from outside ever moves a port call's status (user decision
 * 2026-08-23, spec 0034 §5).
 *
 * data.ingest.<plan|log> holds provenance watermarks; data.suggestions
 * holds the current pending suggestions (resolution-layer state — the
 * append-only lanes live in source_record, invariant 9). Same-transaction
 * org-chain audit for every applied envelope (invariant 5), carrying the
 * full envelope (spec 0033).
 *
 * Status: expected → arrived → departed, never regressing; cancelled is
 * an operator act (soft — compliance history never deletes).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import { SessionUser } from '../auth/session.service';
import type {
  IngestEnvelope,
  AisEventPayload,
  LogEventPayload,
  NextPort,
  PlanPayload,
  PrevPort,
} from '../ingest/envelope.schema';
import { TenantDb } from '../tenancy/tenant-db';
import { agentFromData } from '../admin/org.service';
import { resolveShip } from './ship-resolve';
import { nemoSnapshotOf } from './ship-nemo';
import { firstScheduleProblem, scheduleProblems } from './schedule-rules';
import { onlyPlace, type Place } from './only-place';
import { aliasFor } from '../refdata/location-aliases';
import {
  nemoStatus,
  flowProgress,
  nextReport,
  obligationsOf,
  type NemoStatus,
  type Obligation,
  type ObligationSnapshot,
  type NoticeFacts,
} from './obligations';

/** The envelope kinds this service applies ('ship' goes to ShipMasterService). */
export type PortCallEnvelope = Extract<
  IngestEnvelope,
  { payloadType: 'plan' | 'log-event' | 'ais-event' }
>;

export type IngestAction =
  | 'created'
  | 'plan_updated'
  | 'plan_stale'
  | 'plan_ignored_cancelled'
  | 'log_stale'
  | 'arrival_suggested'
  | 'departure_suggested'
  | 'log_unmatched';

export interface ApplyOutcome {
  action: IngestAction;
  /** Absent when the event could not be placed (log_unmatched). */
  portCallId?: string;
  /** Non-fatal observations for the pushing system (e.g. locode_substituted). */
  warnings?: string[];
  /** What was done about a superseded port code, for the audit trail. */
  substitution?: LocodeSubstitution;
}

/**
 * What was done about a superseded port code (docs/specs/0056). Recorded on
 * the call so an operator sees what the source said and what we used.
 */
export interface LocodeSubstitution {
  given: string;
  used: string;
  note: string;
  candidates: string[];
  sourceSystem: string;
  eventId: string;
  receivedAt: string;
}

/** A pending ship/log-side value awaiting operator confirmation. */
export interface PendingSuggestion {
  value: string;
  /** Which source said it (spec 0095): the logbook, or AIS. Absent on suggestions older than 0095 = log. */
  lane?: 'log' | 'ais';
  portLocode?: string;
  /** AIS only: the berth the geofence names, and where the ship was (never sent to NEMO). */
  berth?: string;
  position?: { latitude: number; longitude: number };
  sourceSystem: string;
  eventId: string;
  occurredAt: string;
  sourceRecordId: string;
  receivedAt: string;
}

/** One entry in the port picker (spec 0042). */
export interface PortOption {
  locode: string;
  name: string | null;
}

/** A berth inside a port area (platform.location.data.portAreas, 0048). */
export interface BerthOption {
  code: string;
  name: string | null;
}

/** One port area of a Finnish port — the VID "sataman osa" (spec 0048). */
export interface PortAreaOption {
  code: string;
  name: string | null;
  isps: boolean;
  berths: BerthOption[];
  /** The area's own security facility code, where published (spec 0051). */
  gisisCode: string | null;
  /** Published anchorages of the area, where any (spec 0051). */
  anchorages: BerthOption[];
}

/** One named security facility (spec 0053): hub codes ∪ the GISIS list. */
export interface PortFacility {
  code: string;
  name: string | null;
  description: string | null;
  /** Retired from the GISIS list (0053 amendment): findable, never offered. */
  retired?: boolean;
}

/** One port at a glance (spec 0051): the value dialog's reference view. */
export interface PortInfo {
  locode: string;
  name: string | null;
  country: string | null;
  facilities: PortFacility[];
  areas: PortAreaOption[];
}

/** platform.location.data.portAreas → the wire shape (specs 0048/0051). */
function mapPortAreas(areas: unknown): PortAreaOption[] {
  if (!Array.isArray(areas)) return [];
  const codeList = (value: unknown): BerthOption[] =>
    Array.isArray(value)
      ? (value as Record<string, unknown>[])
          .filter((b) => !!b && typeof b === 'object')
          .map((b) => ({
            code: String(b['code'] ?? ''),
            name: typeof b['name'] === 'string' ? b['name'] : null,
          }))
          .filter((b) => b.code !== '')
      : [];
  return areas
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      code: String(a['code'] ?? ''),
      name: typeof a['portAreaName'] === 'string' ? a['portAreaName'] : null,
      isps: a['isps'] === true,
      berths: codeList(a['berths']),
      gisisCode: typeof a['gisisCode'] === 'string' ? a['gisisCode'] : null,
      anchorages: codeList(a['anchorages']),
    }))
    .filter((a) => a.code !== '');
}

/** One official cargo on the call (spec 0046): HS6 + the name as picked. */
export interface CargoItem {
  hs6: string;
  name: string;
}

export interface PortCallRow {
  id: string;
  visitId: string | null;
  portLocode: string | null;
  /** Display name joined from platform.location (spec 0047). */
  portName: string | null;
  /** The place inside the port — NEMO PortCall.portAreaCode / berth (0048). */
  portAreaCode: string | null;
  berth: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  status: string | null;
  voyageNumber: string | null;
  cargoDescription: string | null;
  cargoItems: CargoItem[];
  source: string | null;
  sourceCallId: string | null;
  suggestions: Partial<Record<'ata' | 'atd', PendingSuggestion>>;
  /** What each source said, per event (spec 0095): the logbook first, then AIS. */
  actualSources: Record<'ata' | 'atd', PendingSuggestion[]>;
  prevPorts: PrevPort[];
  nextPorts: NextPort[];
  shipId: string | null;
  shipName: string | null;
  imoNumber: string | null;
  updated: string;
  /** Active uploaded documents on the call (spec 0049). */
  documentCount: number;
  /** The ship-movement flow in NEMO vocabulary (spec 0048). */
  nemoStatus: NemoStatus;
  /** The reporting flow: what is done, missing and due when (spec 0048). */
  obligations: Obligation[];
  /** The next report owed, in flow order (spec 0092); null once all are sent. */
  next: string | null;
  /** The always-given reports sent, of all — the card's progress line (spec 0092). */
  progress: { sent: number; total: number };
}

export interface ManualPortCallCreate {
  shipId: string;
  portLocode: string;
  portAreaCode?: string;
  berth?: string;
  eta?: string;
  etd?: string;
  voyageNumber?: string;
  cargoDescription?: string;
  cargoItems?: CargoItem[];
  prevPorts?: PrevPort[];
  nextPorts?: NextPort[];
}

export interface ManualPortCallUpdate {
  portLocode?: string;
  portAreaCode?: string | null;
  berth?: string | null;
  eta?: string | null;
  etd?: string | null;
  ata?: string | null;
  atd?: string | null;
  voyageNumber?: string | null;
  cargoDescription?: string | null;
  cargoItems?: CargoItem[] | null;
  prevPorts?: PrevPort[] | null;
  nextPorts?: NextPort[] | null;
}

/** data.itinerary (spec 0037): the rotation the FI call carries with it. */
interface Itinerary {
  prev?: PrevPort[];
  next?: NextPort[];
}

function itineraryOf(data: Record<string, unknown>): Itinerary {
  const raw = data?.['itinerary'];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Itinerary)
    : {};
}

/** data.cargo (spec 0046): the official cargoes picked for the call. */
function cargoOf(data: Record<string, unknown>): CargoItem[] {
  const raw = data?.['cargo'];
  return Array.isArray(raw) ? (raw as CargoItem[]) : [];
}

interface SpineRow {
  id: string;
  ship_id: string | null;
  status: string | null;
  data: Record<string, unknown>;
}

const SPINE_SQL = `id, ship_id, status, data`;

function lastAppliedOccurredAt(
  data: Record<string, unknown>,
  lane: 'plan' | 'log' | 'ais',
): string | null {
  const ingest = data?.ingest as Record<string, unknown> | undefined;
  const entry = ingest?.[lane] as Record<string, unknown> | undefined;
  const value = entry?.occurredAt;
  return typeof value === 'string' ? value : null;
}

/**
 * Each source's latest actual per event (spec 0095), the logbook before AIS.
 * A suggestion from before 0095 has no actuals entry: it stands as the log's.
 */
export function actualSourcesOf(
  actuals: Record<string, Record<string, PendingSuggestion>> | null | undefined,
  suggestions: Partial<Record<'ata' | 'atd', PendingSuggestion>> | null | undefined,
): Record<'ata' | 'atd', PendingSuggestion[]> {
  const of = (field: 'ata' | 'atd'): PendingSuggestion[] => {
    const lanes = actuals?.[field] ?? {};
    const out = (['log', 'ais'] as const).map((lane) => lanes[lane]).filter((x): x is PendingSuggestion => !!x);
    const pending = suggestions?.[field];
    if (out.length === 0 && pending) out.push({ ...pending, lane: pending.lane ?? 'log' });
    return out;
  };
  return { ata: of('ata'), atd: of('atd') };
}

@Injectable()
export class PortCallService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /**
   * Applies one validated envelope inside the caller's org transaction
   * (the single ingestion function owns the transaction, dedupe and the
   * source_record archive; this owns the domain mutation + audit).
   */
  async apply(
    client: PoolClient,
    schema: string,
    envelope: PortCallEnvelope,
    shipId: string,
    sourceRecordId: string,
  ): Promise<ApplyOutcome> {
    const outcome =
      envelope.payloadType === 'plan'
        ? await this.applyPlan(client, envelope, envelope.payload, shipId, sourceRecordId)
        : await this.applyActualEvent(client, envelope, envelope.payload, shipId, sourceRecordId);
    await this.audit.content(
      {
        actorId: `ingest:${envelope.sourceSystem}`,
        // An unplaceable event has no call to hang on — it audits against
        // its own archived record instead (spec 0034 loose coupling).
        entityType: outcome.portCallId ? 'port_call' : 'source_record',
        entityId: outcome.portCallId ?? sourceRecordId,
        data: {
          action: outcome.action,
          sourceSystem: envelope.sourceSystem,
          eventId: envelope.eventId,
          sourceRecordId,
          payloadType: envelope.payloadType,
          // A port code we did not take at face value is named in the trail,
          // both sides of it (docs/specs/0056 AC 6).
          ...(outcome.substitution ? { locode: outcome.substitution } : {}),
          // The audit chain is self-contained evidence (docs/specs/0033):
          // the full validated POST body, verbatim — the source_record
          // archive is the queryable store, not the proof.
          envelope,
        },
        schema,
      },
      client,
    );
    return outcome;
  }

  // ---- plan ----------------------------------------------------------------

  /**
   * Upsert on (source, source_call_id) — the source system's own UUID is
   * the identity (spec 0034); the 0026 matching ladder is retired for
   * plans. The owning system maintains the base record; it never touches
   * actuals or status.
   */
  private async applyPlan(
    client: PoolClient,
    envelope: PortCallEnvelope,
    plan: PlanPayload,
    shipId: string,
    sourceRecordId: string,
  ): Promise<ApplyOutcome> {
    const voyage = envelope.portCallHint?.voyageNumber ?? plan.voyageNumber ?? null;
    const existing = await client.query<SpineRow>(
      `SELECT ${SPINE_SQL} FROM port_call
        WHERE source = $1 AND source_call_id = $2 AND is_active`,
      [envelope.sourceSystem, plan.sourceCallId],
    );
    const row = existing.rows[0] ?? null;
    if (row && row.ship_id !== shipId) {
      throw new ConflictException({
        error: 'ship_conflict',
        message: 'This sourceCallId already belongs to a different ship',
      });
    }

    const provenance = this.provenance(envelope, sourceRecordId);
    // A superseded or bogus port code is recognised, not rejected (spec 0056).
    const port = await this.resolveLocode(client, envelope, plan.portLocode);
    // The rotation travels with the FI call (spec 0037): whichever of the
    // two arrays the push carries replaces just that one.
    const itineraryPatch: Itinerary = {
      ...(plan.prevPorts ? { prev: plan.prevPorts } : {}),
      ...(plan.nextPorts ? { next: plan.nextPorts } : {}),
    };
    const hasItinerary = plan.prevPorts !== undefined || plan.nextPorts !== undefined;

    // The source's purposes of call, kept with where they came from (spec 0090)
    const purposes = plan.callPurposes
      ? { value: plan.callPurposes, source: envelope.sourceSystem, receivedAt: new Date().toISOString() }
      : null;
    if (!row) {
      const data: Record<string, unknown> = { ingest: { plan: provenance } };
      if (hasItinerary) data['itinerary'] = itineraryPatch;
      if (purposes) data['callPurposes'] = purposes;
      if (port.substitution) {
        data['suggestions'] = { locode: port.substitution };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO port_call
           (ship_id, port_locode, eta, etd, voyage_number, cargo_description,
            status, source_call_id, data, author, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'expected', $7, $8::jsonb, $9, $10)
         RETURNING id`,
        [
          shipId,
          port.locode,
          plan.eta ?? null,
          plan.etd ?? null,
          voyage,
          plan.cargoDescription ?? null,
          plan.sourceCallId,
          JSON.stringify(data),
          `ingest:${envelope.sourceSystem}`,
          envelope.sourceSystem,
        ],
      );
      // A plan does not name the place: the port's only area and berth are taken
      await this.fillOnlyPlace(client, inserted.rows[0]!.id);
      return {
        action: 'created',
        portCallId: inserted.rows[0]!.id,
        ...(port.warnings.length > 0 ? { warnings: port.warnings } : {}),
        ...(port.substitution ? { substitution: port.substitution } : {}),
      };
    }

    if ((row.status ?? 'expected') === 'cancelled') {
      // The operator cancelled this call deliberately — the source's
      // re-send is archived + audited but never reopens it.
      return { action: 'plan_ignored_cancelled', portCallId: row.id };
    }
    if (this.isStale(row, 'plan', envelope.occurredAt)) {
      return { action: 'plan_stale', portCallId: row.id };
    }

    // Absent optional fields leave the stored value untouched — a plan push
    // carries what it knows; clearing is an operator-era concern.
    await client.query(
      `UPDATE port_call SET
         port_locode = $2,
         eta = CASE WHEN $3::boolean THEN $4::timestamptz ELSE eta END,
         etd = CASE WHEN $5::boolean THEN $6::timestamptz ELSE etd END,
         voyage_number = CASE WHEN $7::boolean THEN $8 ELSE voyage_number END,
         cargo_description = CASE WHEN $9::boolean THEN $10 ELSE cargo_description END,
         data = ${laneProvenanceSql('plan', 11)}
           || CASE WHEN $12::boolean
                THEN jsonb_build_object('itinerary',
                       COALESCE(data->'itinerary', '{}'::jsonb) || $13::jsonb)
                ELSE '{}'::jsonb END
           || CASE WHEN $14::boolean
                THEN jsonb_build_object('suggestions',
                       COALESCE(data->'suggestions', '{}'::jsonb)
                         || jsonb_build_object('locode', $15::jsonb))
                ELSE '{}'::jsonb END
           || CASE WHEN $16::boolean
                THEN jsonb_build_object('callPurposes', $17::jsonb)
                ELSE '{}'::jsonb END,
         updated = now()
       WHERE id = $1`,
      [
        row.id,
        port.locode,
        plan.eta !== undefined,
        plan.eta ?? null,
        plan.etd !== undefined,
        plan.etd ?? null,
        voyage !== null,
        voyage,
        plan.cargoDescription !== undefined,
        plan.cargoDescription ?? null,
        JSON.stringify(provenance),
        hasItinerary,
        JSON.stringify(itineraryPatch),
        port.substitution !== null,
        JSON.stringify(port.substitution),
        purposes !== null,
        JSON.stringify(purposes),
      ],
    );
    await this.fillOnlyPlace(client, row.id);
    return {
      action: 'plan_updated',
      portCallId: row.id,
      ...(port.warnings.length > 0 ? { warnings: port.warnings } : {}),
      ...(port.substitution ? { substitution: port.substitution } : {}),
    };
  }

  /**
   * The port code a plan should land on (docs/specs/0056).
   *
   * A code the Finnish port system no longer operates — because the place is a
   * port area of a bigger port, because it was never a LOCODE, or because the
   * place was renamed — is substituted for the current one and flagged, so the
   * call is usable now and the source learns what to fix. A code that is valid
   * for a DIFFERENT place is never substituted: it travels as sent with the
   * candidates recorded, because choosing between real places is an operator's
   * decision. Same for an ambiguous alias with more than one candidate.
   */
  private async resolveLocode(
    client: PoolClient,
    envelope: PortCallEnvelope,
    given: string,
  ): Promise<{
    locode: string;
    warnings: string[];
    substitution: LocodeSubstitution | null;
  }> {
    const alias = await aliasFor(client, given);
    if (!alias) return { locode: given, warnings: [], substitution: null };

    const used = alias.substitute ?? given;
    const substitution: LocodeSubstitution = {
      given,
      used,
      note: alias.note,
      candidates: alias.candidates,
      sourceSystem: envelope.sourceSystem,
      eventId: envelope.eventId,
      receivedAt: new Date().toISOString(),
    };
    return {
      locode: used,
      warnings: [alias.substitute ? 'locode_substituted' : 'locode_uncertain'],
      substitution,
    };
  }

  // ---- actuals: logbook and AIS events (spec 0034, 0095) ----------------------

  /**
   * Log events are loosely coupled (spec 0034): the logbook doesn't know
   * our IDs, so events are ship-scoped and matched by exact reference
   * (portCallId hint from addressed sources, visitId) or closest-by-time
   * among the ship's open calls. NOTHING here writes spine columns or
   * status — the event becomes a pending suggestion the operator must
   * confirm; a wrong match costs nothing. No candidate → the event is
   * archived and held for triage, never rejected.
   */
  private async applyActualEvent(
    client: PoolClient,
    envelope: PortCallEnvelope,
    event: LogEventPayload | AisEventPayload,
    shipId: string,
    sourceRecordId: string,
  ): Promise<ApplyOutcome> {
    // The logbook and AIS are two lanes (spec 0095): each keeps its own
    // provenance and out-of-order guard, and neither overwrites the other
    const lane: 'log' | 'ais' = envelope.payloadType === 'ais-event' ? 'ais' : 'log';
    let row = await this.matchByPortCallId(
      client,
      envelope.portCallHint?.portCallId,
      shipId,
    );
    if (!row) {
      row = await this.matchByVisitId(client, envelope.portCallHint?.visitId, shipId);
    }

    if (!row) {
      const voyage = envelope.portCallHint?.voyageNumber ?? null;
      // ZZUKN = "port not known / no official code" by UN/LOCODE
      // convention — an unknown-port hint carries no information, so it
      // must not filter (a literal match would force unmatched).
      const portHint =
        event.portLocode && event.portLocode !== 'ZZUKN'
          ? event.portLocode
          : null;
      const candidates = await client.query<SpineRow>(
        `SELECT ${SPINE_SQL} FROM port_call
          WHERE ship_id = $1 AND is_active
            AND COALESCE(status, 'expected') NOT IN ('departed', 'cancelled')
            AND ($2::text IS NULL OR port_locode = $2)
            AND ($3::text IS NULL OR voyage_number = $3)
          ORDER BY abs(extract(epoch FROM COALESCE(eta, created) - $4::timestamptz))
          LIMIT 1`,
        [shipId, portHint, voyage, event.timestamp],
      );
      row = candidates.rows[0] ?? null;
    }
    if (!row) {
      return { action: 'log_unmatched' };
    }

    if (this.isStale(row, lane, envelope.occurredAt)) {
      return { action: 'log_stale', portCallId: row.id };
    }

    const provenance = this.provenance(envelope, sourceRecordId);
    const ais = lane === 'ais' ? (event as AisEventPayload) : null;
    const suggestion: PendingSuggestion = {
      value: event.timestamp,
      lane,
      ...(event.portLocode ? { portLocode: event.portLocode } : {}),
      ...(ais?.berth ? { berth: ais.berth } : {}),
      ...(ais?.position ? { position: ais.position } : {}),
      sourceSystem: envelope.sourceSystem,
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
      sourceRecordId,
      receivedAt: new Date().toISOString(),
    };
    // One pending suggestion, the best source: AIS never replaces a
    // logbook suggestion; the logbook replaces an AIS one (spec 0095)
    const pending = (row.data?.suggestions as Record<string, PendingSuggestion> | undefined)?.[event.event];
    const takesPending = lane === 'log' || !pending || (pending.lane ?? 'log') === 'ais';
    await client.query(
      `UPDATE port_call SET
         data = data
           || jsonb_build_object('ingest',
                COALESCE(data->'ingest', '{}'::jsonb)
                  || jsonb_build_object($5::text, $2::jsonb))
           || jsonb_build_object('actuals',
                COALESCE(data->'actuals', '{}'::jsonb)
                  || jsonb_build_object($3::text,
                       COALESCE(data->'actuals'->$3::text, '{}'::jsonb)
                         || jsonb_build_object($5::text, $4::jsonb)))
           || CASE WHEN $6::boolean
                THEN jsonb_build_object('suggestions',
                       COALESCE(data->'suggestions', '{}'::jsonb)
                         || jsonb_build_object($3::text, $4::jsonb))
                ELSE '{}'::jsonb END,
         updated = now()
       WHERE id = $1`,
      [row.id, JSON.stringify(provenance), event.event, JSON.stringify(suggestion), lane, takesPending],
    );
    return {
      action: event.event === 'ata' ? 'arrival_suggested' : 'departure_suggested',
      portCallId: row.id,
    };
  }

  // ---- shared --------------------------------------------------------------

  /** An addressed event names our call exactly — but never across ships. */
  private async matchByPortCallId(
    client: PoolClient,
    portCallId: string | undefined,
    shipId: string,
  ): Promise<SpineRow | null> {
    if (!portCallId) return null;
    const result = await client.query<SpineRow>(
      `SELECT ${SPINE_SQL} FROM port_call WHERE id = $1 AND is_active`,
      [portCallId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.ship_id !== shipId) {
      throw new ConflictException({
        error: 'ship_conflict',
        message: 'The referenced port call belongs to a different ship',
      });
    }
    return row;
  }

  /** M1/L1: a visitId hint is authoritative — but never across ships. */
  private async matchByVisitId(
    client: PoolClient,
    visitId: string | undefined,
    shipId: string,
  ): Promise<SpineRow | null> {
    if (!visitId) return null;
    const result = await client.query<SpineRow>(
      `SELECT ${SPINE_SQL} FROM port_call WHERE visit_id = $1 AND is_active`,
      [visitId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.ship_id !== shipId) {
      throw new ConflictException({
        error: 'ship_conflict',
        message: 'The referenced visit belongs to a different ship',
      });
    }
    return row;
  }

  /** Out-of-order guard: an envelope older than the last applied one of its lane. */
  private isStale(row: SpineRow, lane: 'plan' | 'log' | 'ais', occurredAt: string): boolean {
    const last = lastAppliedOccurredAt(row.data, lane);
    return last !== null && Date.parse(occurredAt) <= Date.parse(last);
  }

  private provenance(
    envelope: PortCallEnvelope,
    sourceRecordId: string,
  ): Record<string, unknown> {
    return {
      sourceSystem: envelope.sourceSystem,
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
      sourceRecordId,
    };
  }

  /** The port's published areas with their berths (0048); none for an unknown port. */
  private async areasOf(client: PoolClient, locode: string | null | undefined): Promise<PortAreaOption[]> {
    if (!locode) return [];
    const row = await client.query(
      `SELECT data->'portAreas' AS areas FROM platform.location
        WHERE locode = $1 AND is_active LIMIT 1`,
      [locode],
    );
    return mapPortAreas(row?.rows?.[0]?.areas);
  }

  /** The area and berth with their only choice filled in (user 2026-11-13); a set value stands. */
  private async placeFor(client: PoolClient, locode: string | null | undefined, place: Place): Promise<Place> {
    if (place.portAreaCode && place.berth) return place;
    return onlyPlace(await this.areasOf(client, locode), place);
  }

  /**
   * After a write that does not name the place (a source's plan): an empty
   * area or berth with one choice is filled. A value already there stands.
   */
  private async fillOnlyPlace(client: PoolClient, portCallId: string): Promise<void> {
    const found = await client.query<{ port_locode: string | null; port_area_code: string | null; berth: string | null }>(
      `SELECT port_locode, port_area_code, berth FROM port_call WHERE id = $1`,
      [portCallId],
    );
    const row = found?.rows?.[0];
    if (!row || (row.port_area_code && row.berth)) return;
    const place = await this.placeFor(client, row.port_locode, { portAreaCode: row.port_area_code, berth: row.berth });
    if (place.portAreaCode === row.port_area_code && place.berth === row.berth) return;
    await client.query(`UPDATE port_call SET port_area_code = $2, berth = $3 WHERE id = $1`, [
      portCallId,
      place.portAreaCode,
      place.berth,
    ]);
  }

  // ---- reads ---------------------------------------------------------------

  /**
   * Org reads are for org-member office roles only: crew gets ship-scoped
   * views with the crew UI spec, and an unswitched platform admin (role
   * 'superadmin', spec 0030) must select a customer first.
   */
  private assertOfficeRole(user: SessionUser): void {
    if (!['admin', 'editor', 'viewer'].includes(user.role)) {
      throw new ForbiddenException();
    }
  }

  /** Confirming actuals is operator work — editors and admins, never viewers. */
  private assertOperatorRole(user: SessionUser): void {
    if (!['admin', 'editor'].includes(user.role)) {
      throw new ForbiddenException();
    }
  }

  // ---- operator confirmation (the only path that moves status) -------------

  private async lockCall(
    client: PoolClient,
    portCallId: string,
  ): Promise<SpineRow & { ata: Date | null; atd: Date | null; visit_id: string | null }> {
    const result = await client.query(
      `SELECT ${SPINE_SQL}, ata, atd, visit_id FROM port_call
        WHERE id = $1 AND is_active FOR UPDATE`,
      [portCallId],
    );
    if (result.rowCount === 0) throw new NotFoundException();
    return result.rows[0];
  }

  private suggestionOf(row: SpineRow, field: 'ata' | 'atd'): PendingSuggestion {
    const all = row.data?.suggestions as
      | Partial<Record<'ata' | 'atd', PendingSuggestion>>
      | undefined;
    const suggestion = all?.[field];
    if (!suggestion) {
      throw new BadRequestException(`No pending ${field.toUpperCase()} suggestion`);
    }
    return suggestion;
  }

  /**
   * Operator confirms a pending suggestion (spec 0034 AC 4): writes the
   * actual, advances status (never regressing), clears the suggestion —
   * audited under the OPERATOR's name with the suggestion's provenance.
   * `value` lets the operator adjust the time while confirming.
   */
  async confirmActual(
    user: SessionUser,
    portCallId: string,
    field: 'ata' | 'atd',
    value?: string,
  ): Promise<void> {
    this.assertOperatorRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const row = await this.lockCall(client, portCallId);
      if ((row.status ?? 'expected') === 'cancelled') {
        throw new BadRequestException('This port call is cancelled');
      }
      const suggestion = this.suggestionOf(row, field);
      const confirmed = value ?? suggestion.value;
      const statusSql =
        field === 'ata'
          ? `CASE WHEN COALESCE(status, 'expected') = 'expected' THEN 'arrived' ELSE status END`
          : `'departed'`;
      await client.query(
        `UPDATE port_call SET
           ${field} = $2::timestamptz,
           status = ${statusSql},
           data = data || jsonb_build_object('suggestions',
                    COALESCE(data->'suggestions', '{}'::jsonb) - $3::text),
           updated = now()
         WHERE id = $1`,
        [portCallId, confirmed, field],
      );
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: {
            action: field === 'ata' ? 'arrival_confirmed' : 'departure_confirmed',
            value: confirmed,
            adjusted: confirmed !== suggestion.value,
            suggestion,
          },
          schema,
        },
        client,
      );
    });
  }

  /** Operator rejects a pending suggestion — cleared, audited, nothing applied. */
  /**
   * The actual NEMO accepted (spec 0092/0095): the ATA or ATD step sent it,
   * so it is recorded on the call as confirmed — the actual set, the status
   * advanced (never regressing), the pending suggestion cleared — audited as
   * reported, with the source whose time it was, if any.
   */
  async recordReportedActual(
    user: SessionUser,
    portCallId: string,
    field: 'ata' | 'atd',
    value: string,
  ): Promise<void> {
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const row = await this.lockCall(client, portCallId);
      const sources = actualSourcesOf(
        row.data?.actuals as Record<string, Record<string, PendingSuggestion>> | undefined,
        row.data?.suggestions as Partial<Record<'ata' | 'atd', PendingSuggestion>> | undefined,
      )[field];
      const from = sources.find((x) => Date.parse(x.value) === Date.parse(value)) ?? null;
      const statusSql =
        field === 'ata'
          ? `CASE WHEN COALESCE(status, 'expected') = 'expected' THEN 'arrived' ELSE status END`
          : `'departed'`;
      await client.query(
        `UPDATE port_call SET
           ${field} = $2::timestamptz,
           status = ${statusSql},
           data = data || jsonb_build_object('suggestions',
                    COALESCE(data->'suggestions', '{}'::jsonb) - $3::text),
           updated = now()
         WHERE id = $1`,
        [portCallId, value, field],
      );
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: {
            action: field === 'ata' ? 'arrival_reported' : 'departure_reported',
            value,
            source: from ? { lane: from.lane ?? 'log', sourceSystem: from.sourceSystem, eventId: from.eventId } : null,
          },
          schema,
        },
        client,
      );
    });
  }

  async rejectSuggestion(
    user: SessionUser,
    portCallId: string,
    field: 'ata' | 'atd',
  ): Promise<void> {
    this.assertOperatorRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const row = await this.lockCall(client, portCallId);
      const suggestion = this.suggestionOf(row, field);
      await client.query(
        `UPDATE port_call SET
           data = data || jsonb_build_object('suggestions',
                    COALESCE(data->'suggestions', '{}'::jsonb) - $2::text),
           updated = now()
         WHERE id = $1`,
        [portCallId, field],
      );
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: {
            action:
              field === 'ata'
                ? 'arrival_suggestion_rejected'
                : 'departure_suggestion_rejected',
            suggestion,
          },
          schema,
        },
        client,
      );
    });
  }

  // ---- manual port calls (admin; spec 0034 §1) -----------------------------

  async createManual(user: SessionUser, input: ManualPortCallCreate): Promise<string> {
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      // In the org's fleet (spec 0068), not merely on the master list
      const ship = await client.query(
        `SELECT s.id FROM platform.ship s
           JOIN fleet_ship f ON f.ship_id = s.id AND f.is_active
          WHERE s.id = $1 AND s.is_active`,
        [input.shipId],
      );
      if (ship.rowCount === 0) throw new NotFoundException('Unknown ship');
      const timeProblem = firstScheduleProblem({ eta: input.eta ?? null, etd: input.etd ?? null });
      if (timeProblem) throw new BadRequestException(timeProblem);
      const itinerary: Itinerary = {
        ...(input.prevPorts ? { prev: input.prevPorts } : {}),
        ...(input.nextPorts ? { next: input.nextPorts } : {}),
      };
      // Only one area, or one berth in the area: it is picked (user 2026-11-13)
      const place = await this.placeFor(client, input.portLocode, {
        portAreaCode: input.portAreaCode ?? null,
        berth: input.berth ?? null,
      });
      const data = {
        ...(input.prevPorts || input.nextPorts ? { itinerary } : {}),
        ...(input.cargoItems && input.cargoItems.length > 0
          ? { cargo: input.cargoItems }
          : {}),
      };
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO port_call
           (ship_id, port_locode, eta, etd, voyage_number, cargo_description,
            status, data, author, source, port_area_code, berth)
         VALUES ($1, $2, $3, $4, $5, $6, 'expected', $7::jsonb, $8, 'manual', $9, $10)
         RETURNING id`,
        [
          input.shipId,
          input.portLocode,
          input.eta ?? null,
          input.etd ?? null,
          input.voyageNumber ?? null,
          input.cargoDescription ?? null,
          JSON.stringify(data),
          user.username,
          place.portAreaCode,
          place.berth,
        ],
      );
      const id = inserted.rows[0]!.id;
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: id,
          data: {
            action: 'created',
            manual: true,
            shipId: input.shipId,
            portLocode: input.portLocode,
            portAreaCode: place.portAreaCode,
            berth: place.berth,
            eta: input.eta ?? null,
            etd: input.etd ?? null,
            voyageNumber: input.voyageNumber ?? null,
            cargoDescription: input.cargoDescription ?? null,
            ...(input.cargoItems ? { cargoItems: input.cargoItems } : {}),
            ...(input.prevPorts ? { prevPorts: input.prevPorts } : {}),
            ...(input.nextPorts ? { nextPorts: input.nextPorts } : {}),
          },
          schema,
        },
        client,
      );
      return id;
    });
  }

  /**
   * Operator edit of the base fields + direct actuals entry (the operator
   * IS the confirmer, so a manual ata/atd advances status by the same
   * rules). On sourced calls the owning system's next push overwrites base
   * fields again — the source owns the base record (user decision).
   * Audited as a field-level diff (spec 0032).
   */
  async updateManual(
    user: SessionUser,
    portCallId: string,
    input: ManualPortCallUpdate,
  ): Promise<void> {
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    await this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const before = await this.lockCall(client, portCallId);
      if ((before.status ?? 'expected') === 'cancelled') {
        throw new BadRequestException('This port call is cancelled');
      }
      // NEMO: once the call exists there, its ship and port cannot change —
      // cancel it and create a new one (Fintraffic user guide; spec 0080)
      if (before.visit_id && input.portLocode !== undefined) {
        const current = await client.query<{ port_locode: string | null }>('SELECT port_locode FROM port_call WHERE id = $1', [portCallId]);
        if (current.rows[0]?.port_locode !== input.portLocode) {
          throw new BadRequestException(
            `The port cannot change once the call is in NEMO (${before.visit_id}) — cancel it and create a new port call`,
          );
        }
      }
      const beforeRow = await client.query(
        `SELECT port_locode, port_area_code, berth, eta, etd, ata, atd,
                voyage_number, cargo_description, status
           FROM port_call WHERE id = $1`,
        [portCallId],
      );
      // The times as they would be after the edit, checked as every send checks
      // them (user 2026-11-13) — only the ones this edit touches, so an older
      // call's other fields stay editable
      {
        const was = beforeRow.rows[0] as Record<string, Date | null> | undefined;
        const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
        const after = {
          eta: 'eta' in input ? (input.eta ?? null) : iso(was?.['eta']),
          etd: 'etd' in input ? (input.etd ?? null) : iso(was?.['etd']),
          ata: 'ata' in input ? (input.ata ?? null) : iso(was?.['ata']),
          atd: 'atd' in input ? (input.atd ?? null) : iso(was?.['atd']),
        };
        const p = scheduleProblems(after);
        const touched = (k: string) => k in input;
        const problem =
          (touched('eta') && p.eta) ||
          ((touched('eta') || touched('etd')) && p.etd) ||
          (touched('ata') && p.ata) ||
          ((touched('ata') || touched('atd')) && p.atd) ||
          null;
        if (problem) throw new BadRequestException(problem);
      }
      // The place (user 2026-11-13): an area or berth this edit leaves alone
      // and that is empty takes the port's only choice; a value stands
      if (!('portAreaCode' in input) || !('berth' in input)) {
        const was = beforeRow.rows[0] as
          | { port_locode: string | null; port_area_code: string | null; berth: string | null }
          | undefined;
        const now: Place = {
          portAreaCode: 'portAreaCode' in input ? (input.portAreaCode ?? null) : (was?.port_area_code ?? null),
          berth: 'berth' in input ? (input.berth ?? null) : (was?.berth ?? null),
        };
        const locode = 'portLocode' in input ? input.portLocode : was?.port_locode;
        const place = await this.placeFor(client, locode, now);
        if (!('portAreaCode' in input) && place.portAreaCode !== now.portAreaCode) {
          input = { ...input, portAreaCode: place.portAreaCode };
        }
        const areaAfter = 'portAreaCode' in input ? (input.portAreaCode ?? null) : now.portAreaCode;
        if (!('berth' in input) && place.berth !== now.berth && areaAfter && areaAfter === place.portAreaCode) {
          input = { ...input, berth: place.berth };
        }
      }
      // Itinerary edits replace the touched array; null clears it. Computed
      // from the locked row (spec 0037).
      const itineraryChange = 'prevPorts' in input || 'nextPorts' in input;
      const beforeItinerary = itineraryOf(before.data);
      const newItinerary: Itinerary = { ...beforeItinerary };
      if ('prevPorts' in input) {
        if (input.prevPorts == null) delete newItinerary.prev;
        else newItinerary.prev = input.prevPorts;
      }
      if ('nextPorts' in input) {
        if (input.nextPorts == null) delete newItinerary.next;
        else newItinerary.next = input.nextPorts;
      }
      // Cargo edits replace the whole list; null clears (spec 0046)
      const cargoChange = 'cargoItems' in input;
      const beforeCargo = cargoOf(before.data);
      const newCargo: CargoItem[] = cargoChange
        ? (input.cargoItems ?? [])
        : beforeCargo;
      const result = await client.query(
        `UPDATE port_call SET
           port_locode = CASE WHEN $2::boolean THEN $3 ELSE port_locode END,
           eta = CASE WHEN $4::boolean THEN $5::timestamptz ELSE eta END,
           etd = CASE WHEN $6::boolean THEN $7::timestamptz ELSE etd END,
           ata = CASE WHEN $8::boolean THEN $9::timestamptz ELSE ata END,
           atd = CASE WHEN $10::boolean THEN $11::timestamptz ELSE atd END,
           voyage_number = CASE WHEN $12::boolean THEN $13 ELSE voyage_number END,
           cargo_description = CASE WHEN $14::boolean THEN $15 ELSE cargo_description END,
           port_area_code = CASE WHEN $20::boolean THEN $21 ELSE port_area_code END,
           berth = CASE WHEN $22::boolean THEN $23 ELSE berth END,
           status = CASE
             WHEN $10::boolean AND $11::timestamptz IS NOT NULL THEN 'departed'
             WHEN $8::boolean AND $9::timestamptz IS NOT NULL
                  AND COALESCE(status, 'expected') = 'expected' THEN 'arrived'
             ELSE status END,
           data = CASE WHEN $18::boolean
                    THEN jsonb_set(
                      CASE WHEN $16::boolean
                        THEN jsonb_set(data, '{itinerary}', $17::jsonb)
                        ELSE data END,
                      '{cargo}', $19::jsonb)
                  WHEN $16::boolean
                    THEN jsonb_set(data, '{itinerary}', $17::jsonb)
                  ELSE data END,
           updated = now()
         WHERE id = $1
         RETURNING port_locode, port_area_code, berth, eta, etd, ata, atd,
                   voyage_number, cargo_description, status`,
        [
          portCallId,
          'portLocode' in input,
          input.portLocode ?? null,
          'eta' in input,
          input.eta ?? null,
          'etd' in input,
          input.etd ?? null,
          'ata' in input,
          input.ata ?? null,
          'atd' in input,
          input.atd ?? null,
          'voyageNumber' in input,
          input.voyageNumber ?? null,
          'cargoDescription' in input,
          input.cargoDescription ?? null,
          itineraryChange,
          JSON.stringify(newItinerary),
          cargoChange,
          JSON.stringify(newCargo),
          'portAreaCode' in input,
          input.portAreaCode ?? null,
          'berth' in input,
          input.berth ?? null,
        ],
      );
      const changes = diffSpine(beforeRow.rows[0], result.rows[0]);
      if (itineraryChange) {
        const route = (ports?: { portLocode: string }[]): string | null =>
          ports && ports.length > 0
            ? ports.map((p) => p.portLocode).join(', ')
            : null;
        if (route(beforeItinerary.prev) !== route(newItinerary.prev)) {
          changes['prevPorts'] = {
            from: route(beforeItinerary.prev),
            to: route(newItinerary.prev),
          };
        }
        if (route(beforeItinerary.next) !== route(newItinerary.next)) {
          changes['nextPorts'] = {
            from: route(beforeItinerary.next),
            to: route(newItinerary.next),
          };
        }
      }
      if (cargoChange) {
        const codes = (items: CargoItem[]): string | null =>
          items.length > 0 ? items.map((i) => i.hs6).join(', ') : null;
        if (codes(beforeCargo) !== codes(newCargo)) {
          changes['cargoItems'] = { from: codes(beforeCargo), to: codes(newCargo) };
        }
      }
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: { action: 'updated', changes },
          schema,
        },
        client,
      );
    });
  }

  /**
   * Soft cancel — compliance history never deletes (spec 0034 AC 5). A call
   * that is in NEMO is cancelled through its COA first (spec 0080), which
   * runs this inside its own transaction (`within`).
   */
  async cancel(user: SessionUser, portCallId: string, reason?: string, within?: PoolClient): Promise<void> {
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    const run = async (client: PoolClient): Promise<void> => {
      const row = await this.lockCall(client, portCallId);
      const status = row.status ?? 'expected';
      if (status === 'departed') {
        throw new BadRequestException('A departed port call cannot be cancelled');
      }
      if (status === 'cancelled') return; // idempotent
      await client.query(
        `UPDATE port_call SET status = 'cancelled', updated = now() WHERE id = $1`,
        [portCallId],
      );
      await this.audit.content(
        {
          actorId: user.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: { action: 'cancelled', from: status, reason: reason ?? null },
          schema,
        },
        client,
      );
    };
    if (within) await run(within);
    else await this.tenantDb.withOrg(user.orgSlug, run);
  }

  /**
   * Port-picker data (spec 0042): the Finnish ports NEMO knows — a LOCODE
   * the hub dataset gives port areas or ISPS facilities (spec 0080; the
   * bare FI LOCODEs are road and rail terminals, airports, inland places) —
   * plus the org's ten most-used ports from its own port calls,
   * per-customer by construction (schema-per-tenant), no separate memory to
   * maintain.
   * Org members including captains (spec 0045: the PEC port picker) —
   * only an unswitched platform admin has no org to read.
   */
  async portOptions(
    user: SessionUser,
  ): Promise<{ frequent: PortOption[]; ports: PortOption[] }> {
    if (!['admin', 'editor', 'viewer', 'captain'].includes(user.role)) {
      throw new ForbiddenException();
    }
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const frequent = await client.query(
        `SELECT pc.port_locode AS locode, max(l.name) AS name
           FROM port_call pc
           LEFT JOIN platform.location l
             ON l.locode = pc.port_locode AND l.is_active
          WHERE pc.port_locode LIKE 'FI%'
          GROUP BY pc.port_locode
          ORDER BY count(*) DESC, pc.port_locode
          LIMIT 10`,
      );
      const ports = await client.query(
        `SELECT locode, name FROM platform.location
          WHERE is_active AND locode LIKE 'FI%'
            AND (data ? 'portAreas' OR data ? 'portFacilityCodes')
          ORDER BY name NULLS LAST, locode`,
      );
      return {
        frequent: frequent.rows as PortOption[],
        ports: ports.rows as PortOption[],
      };
    });
  }

  /**
   * The port areas (and their berths) of one Finnish port — the VID
   * "sataman osa ja laituripaikka" pickers (spec 0048). Reference data
   * from platform.location.data.portAreas (spec 0027); a port with no
   * published areas simply returns none.
   */
  async portAreas(user: SessionUser, locode: string): Promise<PortAreaOption[]> {
    if (!["admin", "editor", "viewer", "captain"].includes(user.role)) {
      throw new ForbiddenException();
    }
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const row = await client.query(
        `SELECT data->'portAreas' AS areas FROM platform.location
          WHERE locode = $1 AND is_active LIMIT 1`,
        [locode],
      );
      return mapPortAreas(row.rows[0]?.areas);
    });
  }

  /**
   * One port at a glance (spec 0051): name, areas with their berths, and
   * the security facilities — what a flagged GISIS code "should perhaps
   * have been". Facilities are the union of the hub dataset's published
   * codes and the uploaded GISIS list (spec 0053), which is where the
   * names come from. Org members including captains.
   */
  async portInfo(user: SessionUser, locode: string): Promise<PortInfo> {
    if (!["admin", "editor", "viewer", "captain"].includes(user.role)) {
      throw new ForbiddenException();
    }
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const row = await client.query(
        `SELECT locode, name, country_code AS country,
                data->'portAreas' AS areas,
                data->'portFacilityCodes' AS facilities
           FROM platform.location
          WHERE locode = $1 AND is_active LIMIT 1`,
        [locode],
      );
      const found = row.rows[0];
      if (!found) throw new NotFoundException();
      const gisis = await client.query(
        `SELECT facility_code, facility_name, description, is_active
           FROM platform.gisis_port_facility
          WHERE locode = $1`,
        [locode],
      );
      const facilities = new Map<string, PortFacility>();
      for (const f of gisis.rows as {
        facility_code: string;
        facility_name: string;
        description: string | null;
        is_active: boolean;
      }[]) {
        facilities.set(f.facility_code, {
          code: f.facility_code,
          name: f.facility_name,
          description: f.description,
          ...(f.is_active ? {} : { retired: true }),
        });
      }
      // The hub dataset syncs daily — a code it still publishes is never
      // shown retired, whatever our (possibly months-old) GISIS copy says.
      const hubCodes = Array.isArray(found.facilities)
        ? (found.facilities as unknown[]).map(String)
        : [];
      for (const code of hubCodes) {
        const existing = facilities.get(code);
        if (existing) delete existing.retired;
        else facilities.set(code, { code, name: null, description: null });
      }
      return {
        locode: found.locode,
        name: found.name ?? null,
        country: found.country ?? null,
        facilities: [...facilities.values()].sort(
          (a, b) =>
            Number(a.retired ?? false) - Number(b.retired ?? false) ||
            a.code.localeCompare(b.code),
        ),
        areas: mapPortAreas(found.areas),
      };
    });
  }

  /**
   * Worldwide port search (spec 0051): the correction picker — a security
   * form's last-10 ports are anywhere, unlike the FI-only call pickers.
   * Locode-prefix and name matches, org members including captains.
   */
  async portSearch(user: SessionUser, q: string): Promise<PortOption[]> {
    if (!['admin', 'editor', 'viewer', 'captain'].includes(user.role)) {
      throw new ForbiddenException();
    }
    const term = q.trim().slice(0, 60);
    if (term.length < 2) return [];
    const escaped = term.replace(/[\\%_]/g, (m) => `\\${m}`);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      // Rank: exact locode, locode prefix, name prefix, then the
      // substring crowd — so "pori" surfaces Pori before Emporia
      const result = await client.query(
        `SELECT locode, name FROM platform.location
          WHERE is_active
            AND (locode ILIKE $1 || '%' OR name ILIKE '%' || $1 || '%')
          ORDER BY (locode = $2) DESC,
                   (locode ILIKE $1 || '%') DESC,
                   (name ILIKE $1 || '%') DESC,
                   name NULLS LAST, locode
          LIMIT 20`,
        [escaped, term.toUpperCase()],
      );
      return result.rows as PortOption[];
    });
  }

  /**
   * Org-scoped canonical list (replaces the steel-thread mock listing).
   * Captains get it too, filtered to their own ship (docs/specs/0049) —
   * an unbound captain simply sees nothing.
   */
  async list(user: SessionUser): Promise<PortCallRow[]> {
    return (await this.load(user, null)).map((x) => x.row);
  }

  /**
   * One call with the snapshot its checklists are built from (spec 0088):
   * the NOA send reads exactly what the NOA panel shows.
   */
  async snapshotFor(user: SessionUser, portCallId: string): Promise<{ row: PortCallRow; snapshot: ObligationSnapshot }> {
    const found = (await this.load(user, portCallId))[0];
    if (!found) throw new NotFoundException('No such port call');
    return found;
  }

  /**
   * The per-call NOA facts NEMOLink has no other source for (spec 0088):
   * purpose, draught, crew, persons on board, master, voyage type. Set
   * fields replace, null clears; audited on the call's chain.
   */
  async setNotice(user: SessionUser, portCallId: string, input: NoticeFacts): Promise<NoticeFacts> {
    this.assertOfficeRole(user);
    const schema = await this.tenantDb.schemaFor(user.orgSlug);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const locked = await client.query<{ notice: NoticeFacts | null }>(
        `SELECT data->'notice' AS notice FROM port_call WHERE id = $1 AND is_active FOR UPDATE`,
        [portCallId],
      );
      if (!locked.rows[0]) throw new NotFoundException('No such port call');
      const before = locked.rows[0].notice ?? {};
      const after: Record<string, unknown> = { ...before };
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (value === null) delete after[key];
        else after[key] = value;
      }
      await client.query(
        `UPDATE port_call SET data = data || jsonb_build_object('notice', $2::jsonb), updated = now() WHERE id = $1`,
        [portCallId, JSON.stringify(after)],
      );
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const from = (before as Record<string, unknown>)[key] ?? null;
        const to = after[key] ?? null;
        if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
      }
      await this.audit.content(
        { actorId: user.username, entityType: 'port_call', entityId: portCallId, data: { action: 'notice_facts_updated', changes }, schema },
        client,
      );
      return after as NoticeFacts;
    });
  }

  private async load(user: SessionUser, only: string | null): Promise<{ row: PortCallRow; snapshot: ObligationSnapshot }[]> {
    const captain = user.role === 'captain';
    if (!captain) this.assertOfficeRole(user);
    if (captain && !user.shipId) return [];
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const result = await client.query(
        `SELECT pc.id, pc.visit_id, pc.port_locode, loc.name AS port_name,
                pc.port_area_code, pc.berth,
                pc.eta, pc.etd, pc.ata,
                pc.atd, pc.status, pc.voyage_number, pc.cargo_description,
                pc.source, pc.source_call_id, pc.data->'suggestions' AS suggestions, pc.data->'actuals' AS actuals,
                pc.data->'nemo' AS nemo, pc.data->'notice' AS notice,
                pc.data->'callPurposes' AS call_purposes, pc.data->'formFacts' AS form_facts,
                pc.data->'itinerary' AS itinerary, pc.data->'cargo' AS cargo,
                pc.created, pc.updated, v.id AS ship_id, v.name AS ship_name,
                v.imo_number, v.mmsi, v.call_sign, v.data AS ship_data,
                f.data AS fleet_data,
                (SELECT count(*)::int FROM port_call_document d
                  WHERE d.port_call_id = pc.id AND d.is_active) AS document_count
           FROM port_call pc
           LEFT JOIN platform.ship v ON v.id = pc.ship_id
           LEFT JOIN fleet_ship f ON f.ship_id = pc.ship_id AND f.is_active
           LEFT JOIN platform.location loc
             ON loc.locode = pc.port_locode AND loc.is_active
          WHERE pc.is_active
            AND COALESCE(pc.status, 'expected') <> 'cancelled'
            AND ($1::uuid IS NULL OR pc.ship_id = $1::uuid)
            AND ($2::uuid IS NULL OR pc.id = $2::uuid)
          ORDER BY COALESCE(pc.eta, pc.created) DESC
          LIMIT 200`,
        [captain ? user.shipId : null, only],
      );
      // The declarant profile (spec 0038) feeds the NOA/DUE readiness —
      // one read per list, not per call.
      const orgRow = await client.query(
        `SELECT name, business_id, data FROM platform.organization WHERE slug = $1`,
        [user.orgSlug],
      );
      const agent = agentFromData(orgRow.rows[0]?.data ?? {});
      const org = {
        name: orgRow.rows[0]?.name ?? null,
        businessId: orgRow.rows[0]?.business_id ?? null,
        agentId: agent.agentId ?? null,
        agencyName: agent.agencyName ?? null,
        agentEmail: agent.email ?? null,
        agentPhone: agent.mobile ?? agent.landline ?? null,
        agentMobile: agent.mobile ?? null,
        street: agent.street ?? null,
        postcode: agent.postcode ?? null,
        city: agent.city ?? null,
        countryCode: agent.countryCode ?? null,
      };
      const now = Date.now();
      const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);
      return result.rows.map((r) => {
        const snapshot = snapshotOf(r, org, now);
        const obligations = obligationsOf(snapshot);
        const row: PortCallRow = {
        id: r.id,
        visitId: r.visit_id,
        portLocode: r.port_locode,
        portName: r.port_name,
        portAreaCode: r.port_area_code,
        berth: r.berth,
        eta: iso(r.eta),
        etd: iso(r.etd),
        ata: iso(r.ata),
        atd: iso(r.atd),
        status: r.status,
        voyageNumber: r.voyage_number,
        cargoDescription: r.cargo_description,
        cargoItems: r.cargo ?? [],
        source: r.source,
        sourceCallId: r.source_call_id,
        suggestions: r.suggestions ?? {},
        actualSources: actualSourcesOf(r.actuals, r.suggestions),
        prevPorts: r.itinerary?.prev ?? [],
        nextPorts: r.itinerary?.next ?? [],
        shipId: r.ship_id,
        shipName: r.ship_name,
        imoNumber: r.imo_number,
        updated: r.updated.toISOString(),
        documentCount: r.document_count ?? 0,
        nemoStatus: nemoStatus({
          status: r.status,
          eta: iso(r.eta),
          ata: iso(r.ata),
          atd: iso(r.atd),
        }),
        obligations,
        next: nextReport(obligations),
        progress: flowProgress(obligations),
        };
        return { row, snapshot };
      });
    });
  }

  /**
   * The call's event history (docs/specs/0035): a read of its own
   * org-chain audit events — self-contained since specs 0032/0033 —
   * mapped to slim rows; the full envelopes/forensics stay in the
   * audit log.
   */
  async timeline(user: SessionUser, portCallId: string): Promise<TimelineEvent[]> {
    this.assertOfficeRole(user);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const exists = await client.query(
        `SELECT id FROM port_call WHERE id = $1 AND is_active`,
        [portCallId],
      );
      if (exists.rowCount === 0) throw new NotFoundException();
      const events = await client.query(
        `SELECT actor_id, data, created FROM audit_event
          WHERE entity_type = 'port_call' AND entity_id = $1
          ORDER BY seq
          LIMIT 300`,
        [portCallId],
      );
      return events.rows.map(mapTimelineEvent);
    });
  }

  /**
   * Fleet view (docs/specs/0029): one row per active ship with its single
   * most relevant call — an open (non-departed) call with the earliest
   * ETA, else the latest departed one, else none. Port display names join
   * read-only from platform.location (schema-qualified reference data —
   * same pattern as the audit log's platform reads).
   */
  async fleet(user: SessionUser): Promise<FleetShip[]> {
    this.assertOfficeRole(user);
    return this.tenantDb.withOrg(user.orgSlug, async (client) => {
      const result = await client.query(
        `SELECT v.id AS ship_id, v.name AS ship_name, v.imo_number,
                v.call_sign,
                pc.id AS call_id, pc.visit_id, pc.port_locode,
                loc.name AS port_name, pc.status, pc.eta, pc.etd, pc.ata,
                pc.atd, pc.voyage_number, pc.cargo_description,
                pc.updated AS call_updated
           FROM fleet_ship f
           JOIN platform.ship v ON v.id = f.ship_id
           LEFT JOIN LATERAL (
             SELECT * FROM port_call p
              WHERE p.ship_id = v.id AND p.is_active
                AND COALESCE(p.status, 'expected') <> 'cancelled'
              ORDER BY (COALESCE(p.status, 'expected') = 'departed'),
                       CASE WHEN COALESCE(p.status, 'expected') <> 'departed'
                            THEN COALESCE(p.eta, p.created) END,
                       COALESCE(p.atd, p.created) DESC
              LIMIT 1
           ) pc ON true
           LEFT JOIN platform.location loc
             ON loc.locode = pc.port_locode AND loc.is_active
          -- The org's fleet (spec 0068): its own shortlist rows
          WHERE f.is_active AND v.is_active`,
      );
      const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);
      return sortFleet(
        result.rows.map((r) => ({
          shipId: r.ship_id,
          name: r.ship_name,
          imoNumber: r.imo_number,
          callSign: r.call_sign,
          call: r.call_id
            ? {
                id: r.call_id,
                visitId: r.visit_id,
                portLocode: r.port_locode,
                portName: r.port_name,
                status: r.status,
                eta: iso(r.eta),
                etd: iso(r.etd),
                ata: iso(r.ata),
                atd: iso(r.atd),
                voyageNumber: r.voyage_number,
                cargoDescription: r.cargo_description,
                updated: r.call_updated.toISOString(),
              }
            : null,
        })),
      );
    });
  }
}

export interface FleetCall {
  id: string;
  visitId: string | null;
  portLocode: string | null;
  portName: string | null;
  status: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  voyageNumber: string | null;
  cargoDescription: string | null;
  updated: string;
}

export interface FleetShip {
  shipId: string;
  name: string | null;
  imoNumber: string | null;
  callSign: string | null;
  call: FleetCall | null;
}

/**
 * Urgency order (docs/specs/0029, pure for tests): in port (by ETD) →
 * expected (by ETA, nulls last) → departed (most recent first) → ships
 * without calls (by name). Name breaks every tie, keeping the order stable.
 */
export function sortFleet(ships: FleetShip[]): FleetShip[] {
  const rank = (s: FleetShip): number => {
    if (!s.call) return 3;
    if (s.call.status === 'arrived') return 0;
    if (s.call.status === 'departed') return 2;
    return 1; // expected (or legacy null status)
  };
  const time = (s: FleetShip): number => {
    const r = rank(s);
    const t =
      r === 0 ? s.call?.etd : r === 1 ? s.call?.eta : r === 2 ? s.call?.atd : null;
    const parsed = t ? Date.parse(t) : NaN;
    if (Number.isNaN(parsed)) return r === 2 ? -Infinity : Infinity; // nulls last
    return r === 2 ? -parsed : parsed; // departed: most recent first
  };
  return [...ships].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      time(a) - time(b) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );
}

export interface TimelineEvent {
  at: string;
  actor: string | null;
  action: string;
  details: Record<string, unknown>;
}

const PLAN_DETAIL_KEYS = [
  'portLocode',
  'eta',
  'etd',
  'voyageNumber',
  'cargoDescription',
  'prevPorts',
  'nextPorts',
] as const;

/**
 * One audit row → one slim timeline row (docs/specs/0035): only what the
 * story needs, per action type of specs 0026–0034.
 */
export function mapTimelineEvent(row: {
  actor_id: string | null;
  data: Record<string, unknown>;
  created: Date | string;
}): TimelineEvent {
  const data = row.data ?? {};
  const action = typeof data['action'] === 'string' ? (data['action'] as string) : 'event';
  const envelope = data['envelope'] as
    | { payload?: Record<string, unknown> }
    | undefined;
  const payload = envelope?.payload ?? {};
  const details: Record<string, unknown> = {};

  switch (action) {
    case 'created':
      if (data['manual'] === true) {
        details['manual'] = true;
        for (const key of PLAN_DETAIL_KEYS) {
          if (data[key] != null) details[key] = data[key];
        }
      } else {
        details['source'] = data['sourceSystem'];
        for (const key of PLAN_DETAIL_KEYS) {
          if (payload[key] != null) details[key] = payload[key];
        }
      }
      break;
    case 'plan_updated':
    case 'plan_stale':
    case 'plan_ignored_cancelled':
      details['source'] = data['sourceSystem'];
      for (const key of PLAN_DETAIL_KEYS) {
        if (payload[key] != null) details[key] = payload[key];
      }
      break;
    case 'arrival_suggested':
    case 'departure_suggested':
      details['source'] = data['sourceSystem'];
      details['value'] = payload['timestamp'];
      break;
    case 'arrival_confirmed':
    case 'departure_confirmed':
      details['value'] = data['value'];
      details['adjusted'] = data['adjusted'];
      break;
    case 'arrival_suggestion_rejected':
    case 'departure_suggestion_rejected':
      details['value'] = (data['suggestion'] as Record<string, unknown> | undefined)?.[
        'value'
      ];
      break;
    case 'updated':
      details['changes'] = data['changes'] ?? {};
      break;
    case 'cancelled':
      details['from'] = data['from'];
      if (data['reason'] != null) details['reason'] = data['reason'];
      break;
    case 'nemo_port_call_created':
      details['visitId'] = data['visitId'];
      details['route'] = data['route'];
      break;
    case 'nemo_port_call_refused':
      details['httpStatus'] = data['httpStatus'];
      details['frmStatus'] = data['frmStatus'];
      details['shipUnknown'] = data['shipUnknown'] === true;
      if (typeof data['words'] === 'string' && data['words']) details['words'] = data['words'];
      break;
    case 'nemo_formality_sent':
      details['formalityType'] = data['formalityType'];
      details['visitId'] = data['visitId'];
      details['accepted'] = data['accepted'];
      if (typeof data['words'] === 'string' && data['words']) details['words'] = data['words'];
      if (data['update'] === true) details['update'] = true;
      if (Array.isArray(data['errors']) && (data['errors'] as unknown[]).length > 0) {
        details['errors'] = data['errors'];
      }
      break;
    default:
      break;
  }
  const created = row.created instanceof Date ? row.created.toISOString() : row.created;
  return { at: created, actor: row.actor_id, action, details };
}

/** Field-level old→new diff for manual edits (spec 0032 pattern). */
/**
 * One list row -> the obligation snapshot (spec 0048). The ship is resolved
 * as the send resolves it — the org's overrides on the master record,
 * To NEMO = override ?? master (spec 0075, the shared `resolveShip`) — so a
 * checklist never counts a value the org has corrected. NEMO's ship
 * database read-back rides along for the In NEMO line.
 */
function snapshotOf(
  r: Record<string, any>,
  org: ObligationSnapshot['org'],
  now: number,
): ObligationSnapshot {
  const shipData = (r.ship_data ?? {}) as Record<string, unknown>;
  const ship = resolveShip(shipData, r.fleet_data, {
    name: r.ship_name,
    mmsi: r.mmsi,
    callSign: r.call_sign,
  });
  const particulars = ship.particulars;
  const nemo = nemoSnapshotOf(shipData);
  const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);
  const codes = (list: unknown): string[] =>
    Array.isArray(list)
      ? list
          .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>)['portLocode'] : null))
          .filter((c): c is string => typeof c === 'string' && c !== '')
      : [];
  return {
    created: r.created ? r.created.toISOString() : new Date(now).toISOString(),
    status: r.status,
    eta: iso(r.eta),
    etd: iso(r.etd),
    ata: iso(r.ata),
    atd: iso(r.atd),
    portLocode: r.port_locode,
    portAreaCode: r.port_area_code,
    berth: r.berth,
    voyageNumber: r.voyage_number,
    cargoDescription: r.cargo_description,
    cargoCount: (r.cargo ?? []).length,
    prevPortCount: (r.itinerary?.prev ?? []).length,
    nextPortCount: (r.itinerary?.next ?? []).length,
    prevPorts: codes(r.itinerary?.prev),
    nextPorts: codes(r.itinerary?.next),
    cargoNames: Array.isArray(r.cargo)
      ? r.cargo
          .map((c: Record<string, unknown>) => (typeof c?.['name'] === 'string' ? (c['name'] as string) : null))
          .filter((n: string | null): n is string => !!n)
      : [],
    ship: r.ship_id
      ? {
          name: ship.name,
          imoNumber: r.imo_number,
          mmsi: ship.mmsi,
          callSign: ship.callSign,
          typeCode: particulars.typeCode,
          flagState: particulars.flagState,
          grossWeight: particulars.grossWeight,
          netWeight: particulars.netWeight,
          length: particulars.length,
          width: particulars.width,
          certificates: ship.certificates.map((c) => ({
            typeCode: c.typeCode,
            expiryDate: c.expiryDate,
          })),
          fields: { ...particulars },
          nemo: nemo ? { shipId: nemo.shipId, fields: nemo.fields } : null,
        }
      : null,
    org,
    // What reached NEMO from here (spec 0070): the visit id says the VID is
    // in, and a report whose last send was accepted counts as sent. Phase 2's
    // read-back (PortCall.submittedFormalities) confirms from NEMO's side; the
    // notices' confirmations come from their StatementTypeCode (spec 0065).
    submitted: submittedOf(r),
    sentBy: sentByOf(r),
    rejected: rejectedOf(r),
    notice: (r.notice ?? {}) as NoticeFacts,
    callPurposes: r.call_purposes ?? null,
    formFacts: r.form_facts ?? null,
    confirmed: confirmedOf(r),
    now,
  };
}

function diffSpine(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: string | null; to: string | null }> {
  const label: Record<string, string> = {
    port_locode: 'portLocode',
    eta: 'eta',
    etd: 'etd',
    ata: 'ata',
    atd: 'atd',
    voyage_number: 'voyageNumber',
    cargo_description: 'cargoDescription',
    port_area_code: 'portAreaCode',
    berth: 'berth',
    status: 'status',
  };
  const norm = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const key of Object.keys(label)) {
    const from = norm(before[key]);
    const to = norm(after[key]);
    if (from !== to) changes[label[key]!] = { from, to };
  }
  return changes;
}

/**
 * SQL expression merging one lane's provenance into data.ingest.<lane>
 * without disturbing the other lane's entry (or anything else in data).
 */
function laneProvenanceSql(lane: 'plan' | 'log', param: number): string {
  return `data || jsonb_build_object('ingest',
      COALESCE(data->'ingest', '{}'::jsonb)
        || jsonb_build_object('${lane}', $${param}::jsonb))`;
}

/**
 * The formality codes NEMOLink itself got into NEMO for a call (spec 0070):
 * VID once the visit id is there, and every report in data.nemo.formalities
 * whose last send was accepted.
 */
/**
 * Per code, the last accepted send (spec 0087): the VID from the visit id's
 * record, the others from their facts. A CRT per certificate: the latest.
 * Sends before 2026-09-26 carry no sender; the time still shows.
 */
function sentByOf(r: Record<string, any>): Record<string, { at: string; by: string | null }> {
  const out: Record<string, { at: string; by: string | null }> = {};
  const nemo = r.nemo ?? {};
  if (typeof r.visit_id === 'string' && r.visit_id && typeof nemo.createdAt === 'string') {
    out['VID'] = { at: nemo.createdAt, by: typeof nemo.createdBy === 'string' ? nemo.createdBy : null };
  }
  const facts = (nemo.formalities ?? {}) as Record<string, { accepted?: boolean; sentAt?: string; sentBy?: string }>;
  for (const [key, fact] of Object.entries(facts)) {
    if (!fact || fact.accepted !== true || typeof fact.sentAt !== 'string') continue;
    const type = key.split(':')[0]!;
    const prior = out[type];
    if (prior && prior.at >= fact.sentAt) continue;
    out[type] = { at: fact.sentAt, by: typeof fact.sentBy === 'string' ? fact.sentBy : null };
  }
  return out;
}

/** Notices whose accepted send carries the customs confirmation: NOA ST-FI-01, NOD ST-FI-02 (spec 0088). */
function confirmedOf(r: Record<string, any>): string[] {
  const facts = (r.nemo?.formalities ?? {}) as Record<string, { accepted?: boolean; statement?: string }>;
  const out: string[] = [];
  if (facts['NOA']?.accepted && facts['NOA'].statement === 'ST-FI-01') out.push('NOA');
  if (facts['NOD']?.accepted && facts['NOD'].statement === 'ST-FI-02') out.push('NOD');
  return out;
}

function submittedOf(r: Record<string, any>): string[] {
  const out: string[] = [];
  if (typeof r.visit_id === 'string' && r.visit_id) out.push('VID');
  const facts = (r.nemo?.formalities ?? {}) as Record<string, { accepted?: boolean; version?: number }>;
  for (const [key, fact] of Object.entries(facts)) {
    // A CRT is kept per certificate, CRT:<type>:<number> (spec 0084)
    const type = key.split(':')[0]!;
    // version counts accepted sends: a refused update leaves the accepted one in NEMO
    const inNemo = fact && (fact.accepted === true || (fact.version ?? 0) > 0);
    if (inNemo && !out.includes(type)) out.push(type);
  }
  return out;
}

/** Per type, the latest send when NEMO refused it (2026-10-06): the chip warns. */
function rejectedOf(r: Record<string, any>): Record<string, { at: string }> {
  const latest: Record<string, { at: string; accepted: boolean }> = {};
  const facts = (r.nemo?.formalities ?? {}) as Record<string, { accepted?: boolean; sentAt?: string }>;
  for (const [key, fact] of Object.entries(facts)) {
    if (!fact || typeof fact.sentAt !== 'string') continue;
    const type = key.split(':')[0]!;
    const prior = latest[type];
    if (prior && prior.at >= fact.sentAt) continue;
    latest[type] = { at: fact.sentAt, accepted: fact.accepted === true };
  }
  const out: Record<string, { at: string }> = {};
  for (const [type, last] of Object.entries(latest)) if (!last.accepted) out[type] = { at: last.at };
  return out;
}
