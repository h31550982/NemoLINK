/**
 * Ship data to NEMO (spec 0070): the confirmation ("this is what NEMO will
 * receive"), the send as the SID and SHP formalities of a port call, and
 * the port call's own creation in NEMO (the VID) when it has no visit id
 * yet. Every wire call is audited by nemo-client (spec 0007); what landed
 * is kept on the port call (`data.nemo`) and said on the org's audit chain.
 */

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { unlinkVisit, visitCancelledIn } from '../canonical/visit-unlink';
import { AuditService } from '../audit/audit.service';
import { SessionUser, assertMaySubmit } from '../auth/session.service';
import {
  documentIdOf,
  nemoShipName,
  parseAck,
  planShipFormalities,
  ShipFieldPlan,
  AckError,
} from '../canonical/ship-formalities';
import type { ParsedAck } from '../canonical/ship-formalities';
import { PortCallService, type PendingSuggestion } from '../canonical/port-call.service';
import { manualOnboardingWords } from '../canonical/ship-nemo';
import { buildMaiEnvelope, MaiDeclarant } from '../nemo-client/mai-envelope';
import { newLrn, planCertificateReports } from '../canonical/certificate-report';
import { CertificateFilesService } from './certificate-files.service';
import { ARRIVAL_CONFIRMATION, buildNoaPayload } from '../canonical/noa-formality';
import { buildDuePayload } from '../canonical/due-formality';
import { buildAtaPayload } from '../canonical/ata-formality';
import { DEPARTURE_CONFIRMATION, buildNodPayload, nodNextPort } from '../canonical/nod-formality';
import { buildAtdPayload } from '../canonical/atd-formality';
import { noaLedger, type LedgerRow, type ShipCells } from '../canonical/noa-ledger';
import { refreshFormFacts } from '../canonical/form-facts';
import { FORMALITY_TITLES, obligationsOf, type ObligationItem, type ObligationSnapshot } from '../canonical/obligations';
import { readBackOf, type ReadBack } from '../nemo-client/read-back';
import { mayUpdate } from '../canonical/formality-rules';
import {
  fingerprintOf,
  PRE_ARRIVAL_REPORTS,
  preArrivalChoices,
  type ReportChoice,
  type StoredChoice,
  type TablesByKey,
} from '../canonical/pre-arrival';
import { DocumentsService } from '../ingest/documents/documents.service';
import { explainFailure, explainVerdict, isUnavailable, type NemoExchange } from '../nemo-client/nemo-exchange';
import { MigValidationError, MigValidator } from '../nemo-client/mig-validator';
import {
  extractVisitId,
  NemoApiError,
  NemoClientService,
  NemoValidationError,
} from '../nemo-client/nemo-client.service';
import { eoriOfClientId, NemoCredentialService } from '../nemo-client/nemo-credential.service';
import { TenantDb } from '../tenancy/tenant-db';
import { agentFromData } from './org.service';
import { ShipsService } from './ships.service';

export type ShipFormalityType =
  | 'SID' | 'SHP' | 'CRT' | 'NOA' | 'DUE' | 'ATA' | 'NOD' | 'ATD'
  // The pre-arrival reports NEMOLink builds (spec 0098)
  | 'CWA' | 'EFF' | 'STA' | 'WAS' | 'SEC';

/** What the port call remembers of one formality we sent (data.nemo.formalities.<TYPE>). */
export interface SentFact {
  /** NEMO's outer formality id (spec 0062 F6), when the list gave it; updates go to it. */
  formalityId: string | null;
  /** Our mai:ExchangedDocument/ram:ID of the last send. */
  documentId: string | null;
  sentAt: string;
  /** FRM status of the last send: '1' accepted, '8' rejected. */
  status: string | null;
  accepted: boolean;
  errors: number;
  /** Accepted sends so far. */
  version: number;
  /** The CRT's local reference number (spec 0084): kept for its updates. */
  lrn?: string;
  /** Who sent it, as the formality panel names them (spec 0087). */
  sentBy?: string;
  /** The declarant statement the send carried — NOA ST-FI-01 = arrival confirmed (spec 0088). */
  statement?: string;
  /** NEMO's copy read back after the send (spec 0089): same, differs, missing or unread. */
  held?: { state: ReadBack['state']; readAt: string; differences: number };
  /** The data section's print (spec 0098): an accepted report with the same print is not sent again. */
  fingerprint?: string;
}

export interface PortCallForNemo {
  id: string;
  visitId: string | null;
  portLocode: string | null;
  eta: string | null;
  etd: string | null;
  status: string | null;
  shipId: string | null;
  formalities: Record<string, SentFact>;
  /** The user's ticks of the pre-arrival reports (spec 0098: data.nemo.reports). */
  reports: Record<string, StoredChoice>;
}

export interface FormalityPreview {
  type: ShipFormalityType;
  willSend: boolean;
  reason: string | null;
  envelope: Record<string, unknown> | null;
  problems: MigValidationError[];
  previously: SentFact | null;
  /** CRT only (spec 0084): the certificate, what it lacks, whether it is already current, its files. */
  certKey?: string;
  gaps?: string[];
  current?: boolean;
  files?: { fileName: string; description: string }[];
  iceClassConfirmation?: boolean;
  fingerprint?: string;
  lrn?: string;
  /** NOA only (spec 0088): the statement it carries, ST-FI-01 when the arrival is confirmed. */
  statement?: string;
}

/** Where a formality's fact lives on the call: its type, or CRT:<certificate> (one CRT per certificate). */
export function factKeyOf(f: { type: ShipFormalityType; certKey?: string }): string {
  return f.type === 'CRT' ? `CRT:${f.certKey ?? ''}` : f.type;
}

export interface ShipNemoPreview {
  ship: { id: string; name: string | null; imoNumber: string | null };
  portCall: PortCallForNemo | null;
  /** The MAI declarant block: the EORI of the organisation the key belongs to, the agency name, role AG. */
  declarant: MaiDeclarant | null;
  /** Where the declarant EORI came from, in words. */
  declarantNote: string;
  policy: string;
  fields: ShipFieldPlan[];
  formalities: FormalityPreview[];
}

export interface FormalityReceipt {
  type: ShipFormalityType;
  accepted: boolean;
  status: string | null;
  errors: AckError[];
  formalityId: string | null;
  documentId: string | null;
  /** Update of an earlier send (PUT, PurposeCode 9) rather than a first send. */
  update: boolean;
  request: Record<string, unknown>;
  response: unknown;
  /** success · rejected (NEMO's verdict) · unavailable (NEMO not reached) · error (spec 0081). */
  outcome: NemoExchange['outcome'];
  exchange: NemoExchange;
  /** Where its fact lives on the call and the fact stored (spec 0089 read-back). */
  factKey?: string;
  fact?: SentFact;
}

/** The NOA wizard's view (spec 0088). */
export interface NoaPreview {
  portCallId: string;
  visitId: string | null;
  shipId: string | null;
  /** Every element as a ledger row (spec 0090): External, NEMOLink, To NEMO, NEMO code, owner. */
  rows: LedgerRow[];
  /** The NOA checklist, as the report panel shows it. */
  items: ObligationItem[];
  missing: string[];
  willSend: boolean;
  reason: string | null;
  envelope: Record<string, unknown> | null;
  problems: MigValidationError[];
  previously: SentFact | null;
  /** An accepted NOA already carries ST-FI-01. */
  confirmed: boolean;
  /** Arrival reports not yet accepted; Fintraffic advises confirming after them. */
  waitingForConfirm: string[];
  /** The DUE, sent with the NOA until NEMO has it (spec 0092); null once accepted. */
  due: { envelope: Record<string, unknown> | null; problems: MigValidationError[]; lrn: string } | null;
  /** The other pre-arrival reports (spec 0098): ticked or not, why, and where their data stands. */
  reports: ReportChoice[];
}

/**
 * One formality on its own (spec 0098 amendment): its chip in the opened
 * card opens it — where it stands, NEMO's reasons for the last refusal,
 * what goes now — and sends just that formality again.
 */
export interface ReportPreview {
  portCallId: string;
  visitId: string | null;
  code: string;
  title: string;
  /** Where its data stands, in words. */
  data: string;
  missing: string[];
  willSend: boolean;
  reason: string | null;
  /** One line per formality that would go — several for the CRT, one per certificate. */
  parts: { label: string; willSend: boolean; reason: string | null }[];
  /** The first envelope that would go (the raw view). */
  envelope: Record<string, unknown> | null;
  problems: MigValidationError[];
  previously: SentFact | null;
  /** NEMO's reasons for refusing the latest send, from the call's audit chain; null unless refused. */
  lastRefusal: { at: string; words: string; errors: AckError[] } | null;
}

/** The formalities that open the single dialog; VID, ATA and ATD have their own single steps. */
export const SINGLE_CODES: ReadonlySet<string> = new Set([
  'NOA', 'DUE', 'NOD', 'SID', 'SHP', 'CRT', 'CWA', 'EFF', 'STA', 'WAS', 'SEC',
]);

/** The ATA or ATD step (spec 0092): the time, what stops it, and what goes. */
export interface ActualPreview {
  portCallId: string;
  visitId: string | null;
  /** The actual time that would go (ISO). */
  at: string;
  /** The estimate it is measured against: the ETA for the arrival, the ETD for the departure. */
  planned: string | null;
  berth: string | null;
  willSend: boolean;
  reason: string | null;
  /** The notice (NOA / NOD) lacks the customs confirmation: the step sends it first (D1). */
  confirmsNotice: boolean;
  /** What the logbook and AIS said (spec 0095), the logbook first; the sheet opens on the first. */
  sources: PendingSuggestion[];
  envelope: Record<string, unknown> | null;
  noticeEnvelope: Record<string, unknown> | null;
  problems: MigValidationError[];
  previously: SentFact | null;
}

/** The NOD dialog's view (spec 0092). */
export interface NodPreview {
  portCallId: string;
  visitId: string | null;
  rows: LedgerRow[];
  missing: string[];
  willSend: boolean;
  reason: string | null;
  envelope: Record<string, unknown> | null;
  problems: MigValidationError[];
  previously: SentFact | null;
  /** An accepted NOD already carries ST-FI-02. */
  confirmed: boolean;
}

export interface ShipSendReceipt {
  visitId: string;
  sentAt: string;
  results: FormalityReceipt[];
}

export const SEND_POLICY_WORDS =
  'The full ship data NEMOLink holds is sent with every port call: the identity (SID) and every ' +
  'particular (SHP) — NEMO\'s record of the ship is shared by every declarant in Finland, so ours ' +
  'restates it each time. Finland requires the identity and eight particulars; the elements of ' +
  'the notices (type, flag, tonnages, dimensions) travel with the NOA and NOD.';

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The HTTP error a failed exchange becomes: its words as the message, the
 * exchange beside them for the result viewer (spec 0081).
 */
function exchangeException(status: number, message: string, exchange: NemoExchange): HttpException {
  const body = { statusCode: status, message, exchange };
  if (status === 422) return new UnprocessableEntityException(body);
  if (status === 503) return new ServiceUnavailableException(body);
  if (status === 502) return new BadGatewayException(body);
  return new HttpException(body, status);
}

export { visitCancelledIn };

/** A refusal that hints the visit is gone: ERR-023 (cancelled), or ERR-019 with OBJECT_NOT_FOUND. */
export function visitGoneHint(errors: AckError[], response: unknown): boolean {
  if (errors.some((e) => e.code === 'ERR-023')) return true;
  const key = (response as { errorKey?: unknown } | null)?.errorKey;
  return errors.some((e) => e.code === 'ERR-019') || key === 'OBJECT_NOT_FOUND';
}

/** NEMO's errors in one line: code, words and the pointer (spec 0078). */
function describe(errors: AckError[], fallback: string): string {
  const words = errors
    .map((e) => [e.code, e.message, e.path ? `(${e.path})` : null].filter(Boolean).join(' '))
    .filter(Boolean);
  return words.length > 0 ? words.join('; ') : fallback;
}

/** A body for the audit chain (spec 0078: the NEMO log): whole up to 16 KB of JSON, else its head and size. */
const AUDIT_BODY_LIMIT = 16 * 1024;
export function boundedForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;
  if (text.length <= AUDIT_BODY_LIMIT) return value;
  return { truncated: true, bytes: text.length, head: text.slice(0, 4096) };
}

@Injectable()
export class ShipNemoService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly nemo: NemoClientService,
    private readonly validator: MigValidator,
    private readonly ships: ShipsService,
    private readonly credentials: NemoCredentialService,
    private readonly portCalls: PortCallService,
    private readonly certFiles: CertificateFilesService,
    // The call's NEMO tables (spec 0098); optional so the send tests run without forms
    @Optional() private readonly documents?: DocumentsService,
  ) {}

  // ---- the confirmation ------------------------------------------------------

  async preview(viewer: SessionUser, shipId: string, portCallId?: string): Promise<ShipNemoPreview> {
    const ship = await this.ships.get(viewer, shipId);
    const plan = planShipFormalities({
      name: ship.name,
      imoNumber: ship.imoNumber,
      mmsi: ship.mmsi,
      callSign: ship.callSign,
      particulars: ship.particulars,
    });
    const { declarant, note: declarantNote } = await this.declarantOf(viewer.orgSlug);
    const portCall = portCallId ? await this.callOf(viewer, portCallId, shipId) : null;

    const formalities: FormalityPreview[] = (['SID', 'SHP'] as const).map((type): FormalityPreview => {
      const payload = type === 'SID' ? plan.sid : plan.shp;
      const planReason = type === 'SID' ? plan.sidReason : plan.shpReason;
      const previously = portCall?.formalities[type] ?? null;
      if (!payload) {
        return { type, willSend: false, reason: planReason, envelope: null, problems: [], previously };
      }
      if (!portCall) {
        return { type, willSend: false, reason: 'Pick a port call to send with', envelope: null, problems: [], previously };
      }
      if (!portCall.visitId) {
        return { type, willSend: false, reason: 'Create the port call in NEMO first', envelope: null, problems: [], previously };
      }
      if (!declarant) {
        return {
          type,
          willSend: false,
          reason: 'Set the EORI in NEMO declarant details first — it names your organisation on every report',
          envelope: null,
          problems: [],
          previously,
        };
      }
      const envelope = buildMaiEnvelope({ formalityType: type, declarant, visitId: portCall.visitId, payload });
      const problems = this.validator.validate(type, envelope);
      return {
        type,
        willSend: problems.length === 0,
        reason: problems.length > 0 ? 'The report does not pass the MIG schema check' : null,
        envelope,
        problems,
        previously,
      };
    });

    // The CRTs (spec 0084): one per certificate that is new, changed or not yet reported
    const crtPlans = planCertificateReports({
      certificates: ship.certificates ?? [],
      files: await this.certFiles.summaryOf(viewer.orgSlug, ship.id),
      reported: await this.reportedCertificates(viewer.orgSlug, ship.id),
      nemo: ship.nemo ? ship.nemo.certificates : null,
      iceClass: (ship.particulars['iceClass'] as { code?: string } | undefined)?.code ?? null,
      iceClassStatus: ((ship.nemo?.fields['iceClass'] ?? {}) as { status?: string }).status ?? null,
      today: new Date().toISOString().slice(0, 10),
    });
    for (const c of crtPlans) {
      const previously = portCall?.formalities[`CRT:${c.certKey}`] ?? null;
      const crt = {
        type: 'CRT' as const,
        certKey: c.certKey,
        gaps: c.gaps,
        current: c.current,
        files: c.files.map((f) => ({ fileName: f.fileName, description: f.description })),
        iceClassConfirmation: c.iceClassConfirmation,
        fingerprint: c.fingerprint,
        previously,
        problems: [] as MigValidationError[],
      };
      const blocked = !c.payload
        ? c.reason
        : !portCall
          ? 'Pick a port call to send with'
          : !portCall.visitId
            ? 'Create the port call in NEMO first'
            : !declarant
              ? 'Set the EORI in NEMO declarant details first — it names your organisation on every report'
              : null;
      if (blocked || !c.payload || !portCall?.visitId || !declarant) {
        formalities.push({ ...crt, willSend: false, reason: blocked, envelope: null });
        continue;
      }
      // The LRN names the CRT for NEMO; an update of the same CRT keeps it
      const lrn = previously?.lrn ?? newLrn();
      const envelope = buildMaiEnvelope({ formalityType: 'CRT', declarant, visitId: portCall.visitId, payload: c.payload, declarationId: lrn });
      const problems = this.validator.validate('CRT', envelope);
      formalities.push({
        ...crt,
        lrn,
        willSend: problems.length === 0,
        reason: problems.length > 0 ? 'The report does not pass the MIG schema check' : null,
        envelope,
        problems,
      });
    }

    return {
      ship: { id: ship.id, name: ship.name, imoNumber: ship.imoNumber },
      portCall,
      declarant,
      declarantNote,
      policy: SEND_POLICY_WORDS,
      fields: plan.fields,
      formalities,
    };
  }

  /** certKey → fingerprint of the org's last accepted CRT of each certificate (spec 0084). */
  private async reportedCertificates(orgSlug: string, shipId: string): Promise<Record<string, string>> {
    const r = await this.tenantDb.withOrg(orgSlug, (client) =>
      client.query<{ reported: Record<string, { fingerprint?: string }> | null }>(
        `SELECT data->'nemoCertificates' AS reported FROM fleet_ship WHERE ship_id = $1 AND is_active`,
        [shipId],
      ),
    );
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.rows[0]?.reported ?? {})) if (v?.fingerprint) out[k] = v.fingerprint;
    return out;
  }

  // ---- the send --------------------------------------------------------------

  async send(viewer: SessionUser, shipId: string, portCallId: string): Promise<ShipSendReceipt> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const preview = await this.preview(viewer, shipId, portCallId);
    const call = preview.portCall;
    if (!call) throw new NotFoundException();
    if (!call.visitId) throw new BadRequestException('Create the port call in NEMO first');
    if (!preview.declarant) {
      throw new BadRequestException('Set the EORI in NEMO declarant details first');
    }
    const toSend = preview.formalities.filter((f) => f.willSend && f.envelope);
    if (toSend.length === 0) {
      throw new BadRequestException(
        preview.formalities.map((f) => `${f.type}: ${f.reason ?? 'nothing to send'}`).join('; '),
      );
    }
    return this.sendEach(viewer, call, shipId, toSend);
  }

  /**
   * Sends the formalities one by one (specs 0070, 0081, 0084, 0088): the
   * update of an earlier send or a first send; the fact kept only when
   * NEMO answered; the exchange audited and returned whole; after NEMO
   * goes down the rest are not tried.
   */
  private async sendEach(
    viewer: SessionUser,
    call: PortCallForNemo,
    shipId: string,
    toSend: FormalityPreview[],
    opts: { visitChecked?: boolean } = {},
  ): Promise<ShipSendReceipt> {
    const visitId = call.visitId as string;
    const org = viewer.orgSlug;
    const schema = await this.tenantDb.schemaFor(org);
    const sentAt = new Date().toISOString();
    const results: FormalityReceipt[] = [];
    let unavailable: ReturnType<typeof explainFailure> | null = null;

    // First: is NEMO up and the visit still alive there (2026-10-06)? A visit
    // NEMO cancelled is unlinked here and nothing is sent; each report says why.
    if (!opts.visitChecked) {
      const gone = await this.visitCheck(viewer, call, toSend.map((f) => f.type).join(' + '));
      if (gone) {
        return {
          visitId,
          sentAt,
          results: toSend.map((f) => {
            const operation = f.type === 'CRT' ? `CRT ${f.certKey?.split(':')[0] ?? ''}`.trim() : f.type;
            return {
              type: f.type, accepted: false, status: null, errors: [], formalityId: null, documentId: null,
              update: false, request: f.envelope!, response: null, outcome: gone.outcome,
              exchange: { ...gone, operation, request: f.envelope },
            };
          }),
        };
      }
    }

    for (const f of toSend) {
      const envelope = f.envelope!;
      const prior = call.formalities[factKeyOf(f)];
      const update = !!prior?.formalityId;
      // Finland's rules (spec 0088): a type that cannot be updated is never sent twice
      if (update && !mayUpdate(f.type)) {
        throw new BadRequestException(`${f.type} cannot be updated once sent`);
      }
      const documentId = documentIdOf(envelope);
      const operation = f.type === 'CRT' ? `CRT ${f.certKey?.split(':')[0] ?? ''}`.trim() : f.type;
      const base = { operation, portCallId: call.id, visitId, at: new Date().toISOString(), request: envelope };
      // A CRT carries its certificate files (spec 0084) and, for CL, may ask for the ice class confirmation
      const optionsFor = async () => f.type === 'CRT' && f.certKey
        ? {
            attachments: (await this.certFiles.contentsOf(org, shipId, f.certKey)).map((x) => ({ fileName: x.fileName, contentType: x.contentType, content: x.content })),
            ...(f.iceClassConfirmation ? { requestIceClassConfirmation: true } : {}),
          }
        : {};

      // NEMO went down on the first report: the next one is not tried (spec 0081)
      if (unavailable) {
        results.push({
          type: f.type, accepted: false, status: null, errors: [], formalityId: prior?.formalityId ?? null,
          documentId: null, update, request: envelope, response: null, outcome: 'unavailable',
          exchange: {
            ...base, ...unavailable, frmStatus: null, errors: [], response: null, auditId: null,
            headline: `${operation} not sent — NEMO is unavailable`,
          },
        });
        continue;
      }

      let response: unknown = null;
      let accepted = false;
      let status: string | null = null;
      let errors: AckError[] = [];
      let httpStatus: number | null = update ? 200 : 201;
      let failure: ReturnType<typeof explainFailure> | null = null;
      try {
        response = update
          ? await this.nemo.updateFormality(org, visitId, f.type, prior!.formalityId!, envelope, await optionsFor())
          : await this.nemo.createFormality(org, visitId, f.type, envelope, await optionsFor());
        const ack = parseAck(response);
        status = ack.status;
        errors = ack.errors;
        accepted = ack.status === '1';
      } catch (error) {
        if (error instanceof NemoValidationError) {
          throw new UnprocessableEntityException(
            `${f.type} does not pass the MIG schema check: ${error.errors.map((e) => `${e.pointer} ${e.message}`).join('; ')}`,
          );
        }
        failure = explainFailure(error);
        httpStatus = failure.httpStatus;
        if (error instanceof NemoApiError) {
          response = error.body ? safeJson(error.body) : null;
          const ack = parseAck(response);
          status = ack.status;
          errors = ack.errors.length > 0 || failure.outcome !== 'rejected' ? ack.errors : [];
        }
        if (failure.outcome === 'unavailable') unavailable = failure;
      }
      const reached = !failure || failure.outcome !== 'unavailable';

      let formalityId = prior?.formalityId ?? null;
      if (accepted && !formalityId) formalityId = await this.outerIdOf(org, visitId, f.type, documentId, f.lrn);

      const fact: SentFact = {
        formalityId,
        documentId,
        sentAt,
        status,
        accepted,
        errors: errors.length,
        version: (prior?.version ?? 0) + (accepted ? 1 : 0),
        ...(f.lrn ? { lrn: f.lrn } : {}),
        sentBy: senderOf(viewer),
        ...(f.fingerprint && f.type !== 'CRT' ? { fingerprint: f.fingerprint } : {}),
        // An accepted confirmation stays confirmed; it cannot be withdrawn (spec 0088)
        ...(f.statement || prior?.statement ? { statement: f.statement ?? prior?.statement } : {}),
      };
      let auditId: string | null = null;
      await this.tenantDb.withOrg(org, async (client) => {
        // Only NEMO's own verdict changes what the call remembers: an
        // unreachable NEMO leaves an earlier accepted send as it was (spec 0081)
        if (reached) {
          await client.query(
            `UPDATE port_call SET
               data = data || jsonb_build_object('nemo',
                        COALESCE(data->'nemo', '{}'::jsonb) || jsonb_build_object('formalities',
                          COALESCE(data->'nemo'->'formalities', '{}'::jsonb) || $2::jsonb)),
               updated = now()
             WHERE id = $1`,
            [call.id, JSON.stringify({ [factKeyOf(f)]: fact })],
          );
        }
        // An accepted CRT makes the certificate current for this ship (emsw.fi: new or changed only)
        if (accepted && f.type === 'CRT' && f.certKey && f.fingerprint) {
          await client.query(
            `UPDATE fleet_ship SET
               data = jsonb_set(data, '{nemoCertificates}',
                        COALESCE(data->'nemoCertificates', '{}'::jsonb) || $2::jsonb),
               updated = now()
             WHERE ship_id = $1 AND is_active`,
            [shipId, JSON.stringify({ [f.certKey]: { fingerprint: f.fingerprint, visitId, sentAt } })],
          );
        }
        auditId = await this.audit.content(
          {
            actorId: viewer.username,
            entityType: 'port_call',
            entityId: call.id,
            data: {
              action: 'nemo_formality_sent',
              formalityType: f.type,
              ...(f.statement ? { statement: f.statement } : {}),
              ...(f.certKey ? { certKey: f.certKey } : {}),
              ...(f.iceClassConfirmation ? { requestIceClassConfirmation: true } : {}),
              visitId,
              shipId,
              accepted,
              outcome: accepted ? 'success' : (failure?.outcome ?? 'rejected'),
              httpStatus,
              status,
              update,
              formalityId,
              documentId,
              // the exchange, whole (spec 0078: the NEMO log)
              errors,
              words: describe(errors, '') || (failure ? failure.headline : ''),
              request: boundedForAudit(envelope),
              response: boundedForAudit(response),
            },
            schema,
          },
          client,
        );
      });

      const verdict = accepted || !failure || failure.outcome === 'rejected'
        ? explainVerdict({ status, errors, frmErrors: errors.length }, f.type)
        : failure;
      results.push({
        type: f.type,
        accepted,
        status,
        errors,
        formalityId,
        documentId,
        update,
        request: envelope,
        response,
        factKey: factKeyOf(f),
        fact,
        outcome: accepted ? 'success' : (failure?.outcome ?? 'rejected'),
        exchange: {
          ...base,
          outcome: accepted ? 'success' : (failure?.outcome ?? 'rejected'),
          httpStatus,
          frmStatus: status,
          headline: accepted ? `NEMO accepted the ${f.type}${update ? ' update' : ''}` : verdict.headline,
          explanation: verdict.explanation,
          errors,
          response,
          auditId,
        },
      });
    }

    // A refusal that says the visit is gone (ERR-023 cancelled; ERR-019 out of
    // sequence with OBJECT_NOT_FOUND): look again, and unlink when NEMO cancelled it
    if (results.some((r) => !r.accepted && visitGoneHint(r.errors, r.response))) {
      const gone = await this.visitCheck(viewer, call, 'after the refusal');
      if (gone && gone.outcome !== 'unavailable') {
        for (const r of results) {
          if (r.accepted) continue;
          r.exchange = { ...r.exchange, headline: `${r.exchange.headline} — ${gone.headline}`, explanation: `${r.exchange.explanation} ${gone.explanation}`.trim() };
        }
      }
    }

    await this.readBack(viewer, call, shipId, results);
    return { visitId, sentAt, results };
  }

  /**
   * Is NEMO up, and is the visit still alive there? One read of its formality
   * list (2026-10-06). Live: null. Not reached: an 'unavailable' exchange.
   * Cancelled in NEMO (a COA in, the VID invalidated, or the visit unknown):
   * the call is unlinked — visit id cleared, the VID unsent again — and a
   * 'rejected' exchange says so.
   */
  private async visitCheck(viewer: SessionUser, call: PortCallForNemo, operation: string): Promise<NemoExchange | null> {
    const visitId = call.visitId as string;
    const org = viewer.orgSlug;
    const base = { operation, portCallId: call.id, visitId, at: new Date().toISOString(), request: null, errors: [] as AckError[], auditId: null };
    let list: unknown = null;
    let httpStatus = 200;
    try {
      list = await this.nemo.getFormalities(org, visitId);
    } catch (error) {
      if (error instanceof NemoApiError && error.status === 404) {
        httpStatus = 404;
      } else {
        const failure = explainFailure(error);
        return { ...base, ...failure, frmStatus: null, response: null, headline: `Not sent — ${failure.headline}` };
      }
    }
    if (httpStatus === 200 && !visitCancelledIn(list)) return null;
    const schema = await this.tenantDb.schemaFor(org);
    const reason = httpStatus === 200 ? 'cancelled in NEMO' : 'visit not found in NEMO (HTTP 404)';
    await this.tenantDb.withOrg(org, (client) => this.unlinkVisit(client, viewer, call, visitId, reason, schema));
    return {
      ...base,
      outcome: 'rejected',
      httpStatus,
      frmStatus: null,
      response: list,
      headline: `NEMO had cancelled ${visitId}`,
      explanation:
        'NEMOLink has unlinked the port call from that visit: its VID is unsent again. ' +
        'Create it in NEMO anew if the call is still on, or cancel it here.',
    };
  }

  /** Unlinks the call from a visit NEMO cancelled: VID unsent again, the old visit kept (canonical/visit-unlink). */
  private async unlinkVisit(
    client: PoolClient,
    viewer: SessionUser,
    call: PortCallForNemo,
    visitId: string,
    reason: string,
    schema: string,
  ): Promise<void> {
    await unlinkVisit(client, this.audit, { actorId: viewer.username, portCallId: call.id, visitId, shipId: call.shipId, reason, schema });
  }


  /**
   * After the sends, one read of NEMO's formality list (spec 0089): each
   * accepted formality is found in it and compared with what we sent. The
   * verdict rides on the exchange (the result dialog shows it), on the
   * fact (the report panel) and on the call's chain. A failed read never
   * undoes a send; it says "unread".
   */
  private async readBack(viewer: SessionUser, call: PortCallForNemo, shipId: string, results: FormalityReceipt[]): Promise<void> {
    const accepted = results.filter((r) => r.accepted);
    if (accepted.length === 0) return;
    const org = viewer.orgSlug;
    const visitId = call.visitId as string;
    let list: unknown = null;
    try {
      list = await this.nemo.getFormalities(org, visitId);
    } catch {
      list = null;
    }
    const facts: Record<string, SentFact> = {};
    for (const r of accepted) {
      const verdict = readBackOf(list, r.type, r.request, { formalityId: r.formalityId, documentId: r.documentId }, documentIdOf);
      r.exchange.readBack = verdict;
      const key = r.type === 'CRT' ? (r.factKey ?? 'CRT') : r.type;
      const prior = call.formalities[key];
      facts[key] = {
        ...(prior ?? ({} as SentFact)),
        ...(r.fact ?? {}),
        held: { state: verdict.state, readAt: verdict.readAt, differences: verdict.differences.length },
      } as SentFact;
    }
    const schema = await this.tenantDb.schemaFor(org);
    await this.tenantDb.withOrg(org, async (client) => {
      await client.query(
        `UPDATE port_call SET
           data = data || jsonb_build_object('nemo',
                    COALESCE(data->'nemo', '{}'::jsonb) || jsonb_build_object('formalities',
                      COALESCE(data->'nemo'->'formalities', '{}'::jsonb) || $2::jsonb))
         WHERE id = $1`,
        [call.id, JSON.stringify(facts)],
      );
      await this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'port_call',
          entityId: call.id,
          data: {
            action: 'nemo_read_back',
            visitId,
            shipId,
            results: accepted.map((r) => ({
              formalityType: r.type,
              formalityId: r.formalityId,
              state: r.exchange.readBack?.state ?? 'unread',
              differences: (r.exchange.readBack?.differences ?? []).slice(0, 20),
            })),
          },
          schema,
        },
        client,
      );
    });
  }

  // ---- the pre-arrival notice (the NOA, spec 0088) -------------------------------

  /**
   * What the NOA would carry for this call: the checklist the NOA panel
   * shows (spec 0087), the envelope built from the same snapshot, its
   * schema check, and whether the arrival may be confirmed. `confirm` adds
   * ST-FI-01; a NOA already confirmed keeps it (it cannot be withdrawn).
   */
  async noaPreview(viewer: SessionUser, portCallId: string, confirm = false): Promise<NoaPreview> {
    // The forms' facts, fresh — also fills calls whose forms came before spec 0090
    await this.tenantDb.withOrg(viewer.orgSlug, (client) => refreshFormFacts(client, portCallId));
    const { snapshot } = await this.portCalls.snapshotFor(viewer, portCallId);
    const call = await this.callOf(viewer, portCallId);
    const rows = await this.ledgerOf(viewer, call, snapshot);
    const obligations = obligationsOf(snapshot);
    const noa = obligations.find((o) => o.code === 'NOA')!;
    // The DUE goes with the NOA until NEMO has it (spec 0092: the pre-arrival reports ride with the NOA)
    const duePrior = call.formalities['DUE'] ?? null;
    const dueOb = duePrior?.accepted ? null : (obligations.find((o) => o.code === 'DUE') ?? null);
    const missing = [...noa.missing, ...(dueOb?.missing ?? [])];
    const previously = call.formalities['NOA'] ?? null;
    const confirmed = !!previously?.accepted && previously.statement === ARRIVAL_CONFIRMATION;
    const statement = confirm || confirmed ? ARRIVAL_CONFIRMATION : undefined;
    // Fintraffic: confirm only once the other arrival reports are in (DUE among them)
    const waitingForConfirm = ['DUE'].filter((code) => !snapshot.submitted.includes(code));
    const { declarant } = await this.declarantOf(viewer.orgSlug);
    let reason: string | null = null;
    if (!call.visitId) reason = 'Create the port call in NEMO first (VID)';
    else if (call.formalities['ATA']?.accepted) reason = 'The arrival is reported (ATA): NEMO takes no more changes to the NOA';
    else if (!declarant) reason = 'Set the EORI in NEMO declarant details first — it names your organisation on every report';
    else if (missing.length > 0) reason = `Still missing: ${missing.join(', ')}`;
    const envelope = !reason
      ? buildMaiEnvelope({ formalityType: 'NOA', declarant: declarant!, visitId: call.visitId!, payload: buildNoaPayload(snapshot, !!statement) })
      : null;
    const problems = envelope ? this.validator.validate('NOA', envelope) : [];
    if (!reason && problems.length > 0) reason = 'The NOA does not pass the MIG schema check';
    let due: NoaPreview['due'] = null;
    if (dueOb) {
      const lrn = duePrior?.lrn ?? newLrn();
      const dueEnvelope = !reason
        ? buildMaiEnvelope({ formalityType: 'DUE', declarant: declarant!, visitId: call.visitId!, payload: buildDuePayload(snapshot), declarationId: lrn })
        : null;
      const dueProblems = dueEnvelope ? this.validator.validate('DUE', dueEnvelope) : [];
      if (!reason && dueProblems.length > 0) reason = 'The DUE does not pass the MIG schema check';
      due = { envelope: dueEnvelope, problems: dueProblems, lrn };
    }
    const { choices } = await this.preArrivalOf(viewer, call, snapshot);
    return {
      portCallId,
      visitId: call.visitId,
      shipId: call.shipId,
      rows,
      items: noa.items,
      missing,
      willSend: !reason,
      reason,
      envelope,
      problems,
      previously,
      confirmed,
      waitingForConfirm,
      due,
      reports: choices,
    };
  }

  /**
   * The pre-arrival reports for this call (spec 0098): the NEMO tables read
   * through the audited path (personal data), the port area's GISIS code
   * for SEC, the user's ticks. Without the documents service (tests) the
   * tables are empty.
   */
  private async preArrivalOf(
    viewer: SessionUser,
    call: PortCallForNemo,
    snapshot: ObligationSnapshot,
  ): Promise<ReturnType<typeof preArrivalChoices>> {
    const tables: TablesByKey = {};
    if (this.documents) {
      for (const t of await this.documents.formTables(viewer, call.id)) tables[t.key] = t;
    }
    let facility: string | null = null;
    if (snapshot.portLocode && snapshot.portAreaCode) {
      const areas = await this.portCalls.portAreas(viewer, snapshot.portLocode).catch(() => []);
      facility = areas.find((a) => a.code === snapshot.portAreaCode)?.gisisCode ?? null;
    }
    return preArrivalChoices({
      tables,
      stored: call.reports,
      sent: call.formalities,
      facility,
      cargo: { count: snapshot.cargoCount, description: snapshot.cargoDescription },
    });
  }

  /** The ticked reports that are ready and not already current in NEMO, as sendable previews. */
  private async readyReports(viewer: SessionUser, call: PortCallForNemo): Promise<FormalityPreview[]> {
    const { snapshot } = await this.portCalls.snapshotFor(viewer, call.id);
    const { choices, built } = await this.preArrivalOf(viewer, call, snapshot);
    const { declarant } = await this.declarantOf(viewer.orgSlug);
    const out: FormalityPreview[] = [];
    for (const c of choices) {
      const b = built[c.code];
      if (!c.on || c.current || !b || !('payload' in b) || !declarant || !call.visitId) continue;
      const type = c.code as ShipFormalityType;
      const envelope = buildMaiEnvelope({ formalityType: type, declarant, visitId: call.visitId, payload: b.payload });
      const problems = this.validator.validate(type, envelope);
      if (problems.length > 0) {
        throw new UnprocessableEntityException(
          `${type} does not pass the MIG schema check: ${problems.map((e) => `${e.pointer} ${e.message}`).join('; ')}`,
        );
      }
      out.push({
        type,
        willSend: true,
        reason: null,
        envelope,
        problems: [],
        previously: call.formalities[type] ?? null,
        fingerprint: fingerprintOf(b.payload),
      });
    }
    return out;
  }

  /** One formality on its own (spec 0098 amendment): what the dialog shows. */
  async reportPreview(viewer: SessionUser, portCallId: string, code: string): Promise<ReportPreview> {
    return (await this.single(viewer, portCallId, code)).preview;
  }

  /** Send that one formality again, through the shared loop: visit check, fact, read-back. */
  async sendReport(viewer: SessionUser, portCallId: string, code: string): Promise<ShipSendReceipt> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const { preview, toSend } = await this.single(viewer, portCallId, code);
    if (!preview.willSend || toSend.length === 0) throw new BadRequestException(preview.reason ?? `The ${code} cannot be sent`);
    const call = await this.callOf(viewer, portCallId);
    if (!call.shipId) throw new BadRequestException('The port call has no ship');
    return this.sendEach(viewer, call, call.shipId, toSend);
  }

  /**
   * What one formality would send, from the builder each flow already
   * uses: the pre-arrival reports from the forms (spec 0098), the NOA and
   * the NOD from their wizards' previews (their customs confirmation kept),
   * the DUE on its own, the SID / SHP / CRT from the ship's plan.
   */
  private async single(
    viewer: SessionUser,
    portCallId: string,
    code: string,
  ): Promise<{ preview: ReportPreview; toSend: FormalityPreview[] }> {
    if (!SINGLE_CODES.has(code)) throw new BadRequestException(`${code} does not open on its own here`);
    const call = await this.callOf(viewer, portCallId);
    const out = {
      portCallId,
      visitId: call.visitId,
      code,
      title: FORMALITY_TITLES[code] ?? code,
      problems: [] as MigValidationError[],
      previously: (call.formalities[code] ?? null) as SentFact | null,
    };
    let data = '';
    let missing: string[] = [];
    let reason: string | null = null;
    let toSend: FormalityPreview[] = [];
    let blocked: FormalityPreview[] = [];
    const notReady = 'Create the port call in NEMO first (VID)';

    if (code === 'NOA') {
      const p = await this.noaPreview(viewer, portCallId);
      const ready = p.rows.filter((r) => r.ok).length;
      data = `${ready} of ${p.rows.length} fields ready`;
      missing = p.items.filter((i) => !i.ok).map((i) => (i.de ? `${i.label} (${i.de})` : i.label));
      reason = p.reason;
      if (p.willSend && p.envelope) {
        toSend = [{
          type: 'NOA', willSend: true, reason: null, envelope: p.envelope, problems: [], previously: p.previously,
          ...(p.confirmed ? { statement: ARRIVAL_CONFIRMATION } : {}),
        }];
      }
    } else if (code === 'NOD') {
      const p = await this.nodPreview(viewer, portCallId);
      data = 'The ETD, the next port, the crew and the persons on board';
      missing = p.missing;
      reason = p.reason;
      if (p.willSend && p.envelope) {
        toSend = [{
          type: 'NOD', willSend: true, reason: null, envelope: p.envelope, problems: [], previously: p.previously,
          ...(p.confirmed ? { statement: DEPARTURE_CONFIRMATION } : {}),
        }];
      }
    } else if (code === 'DUE') {
      const { snapshot } = await this.portCalls.snapshotFor(viewer, portCallId);
      const due = obligationsOf(snapshot).find((o) => o.code === 'DUE')!;
      const { declarant } = await this.declarantOf(viewer.orgSlug);
      data = 'Fairway and port dues — your agency as the liable party';
      missing = due.missing;
      if (!call.visitId) reason = notReady;
      else if (!declarant) reason = 'Set the EORI in NEMO declarant details first — it names your organisation on every report';
      else if (missing.length > 0) reason = `Still missing: ${missing.join(', ')}`;
      if (!reason) {
        const lrn = out.previously?.lrn ?? newLrn();
        const envelope = buildMaiEnvelope({ formalityType: 'DUE', declarant: declarant!, visitId: call.visitId!, payload: buildDuePayload(snapshot), declarationId: lrn });
        out.problems = this.validator.validate('DUE', envelope);
        if (out.problems.length > 0) reason = 'The DUE does not pass the MIG schema check';
        else toSend = [{ type: 'DUE', willSend: true, reason: null, envelope, problems: [], previously: out.previously, lrn }];
      }
    } else if (code === 'SID' || code === 'SHP' || code === 'CRT') {
      if (!call.shipId) throw new BadRequestException('The port call has no ship');
      const p = await this.preview(viewer, call.shipId, portCallId);
      const mine = p.formalities.filter((f) => f.type === code);
      toSend = mine.filter((f) => f.willSend && f.envelope);
      blocked = mine.filter((f) => !f.willSend);
      out.problems = mine.flatMap((f) => f.problems);
      if (code === 'CRT') {
        const name = (f: FormalityPreview) => f.certKey?.split(':')[0] ?? 'CRT';
        data = mine.length
          ? `${mine.length} certificate${mine.length === 1 ? '' : 's'}: ${mine.map((f) => `${name(f)}${f.current ? ' (in NEMO, unchanged)' : ''}`).join(', ')}`
          : 'No certificates on the ship';
        missing = mine.flatMap((f) => (f.gaps ?? []).map((g) => `${name(f)}: ${g}`));
        out.previously = Object.entries(call.formalities).find(([k]) => k.startsWith('CRT:'))?.[1] ?? null;
      } else {
        data = code === 'SID' ? "The ship's identity: name, IMO, MMSI, call sign, flag" : "The ship's particulars";
      }
      if (toSend.length === 0) {
        reason = blocked.map((f) => f.reason).filter(Boolean)[0] ?? (mine.length ? 'Nothing to send' : 'No certificates to report');
      }
    } else {
      // The reports that go with the NOA (spec 0098)
      const def = PRE_ARRIVAL_REPORTS.find((r) => r.code === code && r.built)!;
      out.title = def.title;
      const { snapshot } = await this.portCalls.snapshotFor(viewer, portCallId);
      const { choices, built } = await this.preArrivalOf(viewer, call, snapshot);
      const choice = choices.find((c) => c.code === code)!;
      const b = built[code]!;
      const { declarant } = await this.declarantOf(viewer.orgSlug);
      data = choice.data;
      missing = choice.missing;
      if (!call.visitId) reason = notReady;
      else if (!declarant) reason = 'Set the EORI in NEMO declarant details first — it names your organisation on every report';
      else if (code === 'SEC' && !snapshot.submitted.includes('NOA')) reason = 'Send the NOA first — the security notice refers to it';
      else if (!('payload' in b)) reason = `Still missing: ${b.missing.join('; ')}`;
      else if (choice.current) reason = 'NEMO has this data already — nothing changed since';
      if (!reason && 'payload' in b) {
        const envelope = buildMaiEnvelope({ formalityType: code, declarant: declarant!, visitId: call.visitId!, payload: b.payload });
        out.problems = this.validator.validate(code, envelope);
        if (out.problems.length > 0) reason = `The ${code} does not pass the MIG schema check`;
        else {
          toSend = [{
            type: code as ShipFormalityType, willSend: true, reason: null, envelope, problems: [],
            previously: out.previously, fingerprint: fingerprintOf(b.payload),
          }];
        }
      }
    }

    const label = (f: FormalityPreview) => (f.type === 'CRT' ? `CRT ${f.certKey?.split(':')[0] ?? ''}`.trim() : f.type);
    const refused = Object.entries(call.formalities).some(([k, f]) => k.split(':')[0] === code && f && !f.accepted);
    return {
      preview: {
        ...out,
        data,
        missing,
        willSend: toSend.length > 0,
        reason: toSend.length > 0 ? null : reason,
        parts: [
          ...toSend.map((f) => ({ label: label(f), willSend: true, reason: null })),
          ...blocked.map((f) => ({ label: label(f), willSend: false, reason: f.reason })),
        ],
        envelope: toSend[0]?.envelope ?? null,
        lastRefusal: refused ? await this.lastRefusal(viewer, portCallId, code) : null,
      },
      toSend,
    };
  }

  /** NEMO's reasons for the latest refused send of `code` on this call (the audit chain keeps the exchange). */
  private async lastRefusal(viewer: SessionUser, portCallId: string, code: string): Promise<ReportPreview['lastRefusal']> {
    const found = await this.tenantDb.withOrg(viewer.orgSlug, (client: PoolClient) =>
      client.query<{ data: Record<string, unknown>; created: Date }>(
        `SELECT data, created FROM audit_event
          WHERE entity_type = 'port_call' AND entity_id = $1
            AND data->>'action' = 'nemo_formality_sent' AND data->>'formalityType' = $2
          ORDER BY seq DESC LIMIT 1`,
        [portCallId, code],
      ),
    );
    const row = found.rows[0];
    if (!row || row.data['accepted'] === true) return null;
    return {
      at: row.created.toISOString(),
      words: typeof row.data['words'] === 'string' ? row.data['words'] : '',
      errors: Array.isArray(row.data['errors']) ? (row.data['errors'] as AckError[]) : [],
    };
  }

  /** Tick or untick one pre-arrival report for this call (spec 0098), audited in the same transaction. */
  async setReportChoice(viewer: SessionUser, portCallId: string, code: string, on: boolean): Promise<NoaPreview> {
    assertMaySubmit(viewer);
    const def = PRE_ARRIVAL_REPORTS.find((r) => r.code === code);
    if (!def) throw new BadRequestException(`${code} is not a pre-arrival report`);
    if (!def.built) throw new BadRequestException(`${code} is not in NEMOLink yet — send it in NEMO`);
    const choice: StoredChoice = { on, by: senderOf(viewer), at: new Date().toISOString() };
    const schema = await this.tenantDb.schemaFor(viewer.orgSlug);
    await this.tenantDb.withOrg(viewer.orgSlug, async (client) => {
      const r = await client.query(
        `UPDATE port_call SET
           data = data || jsonb_build_object('nemo',
                    COALESCE(data->'nemo', '{}'::jsonb) || jsonb_build_object('reports',
                      COALESCE(data->'nemo'->'reports', '{}'::jsonb) || $2::jsonb)),
           updated = now()
         WHERE id = $1 AND is_active`,
        [portCallId, JSON.stringify({ [code]: choice })],
      );
      if (r.rowCount === 0) throw new NotFoundException('No such port call');
      await this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'port_call',
          entityId: portCallId,
          data: { action: 'nemo_report_choice', code, on },
          schema,
        },
        client,
      );
    });
    return this.noaPreview(viewer, portCallId);
  }

  /**
   * Sends the NOA (a first send, or the update of the earlier one) through
   * the shared loop, read-back included. `confirm` is the sender's explicit
   * answer — the wizard has no default (user decision 2026-09-26).
   */
  async sendNoa(viewer: SessionUser, portCallId: string, confirm: boolean): Promise<ShipSendReceipt> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const preview = await this.noaPreview(viewer, portCallId, confirm);
    if (!preview.willSend || !preview.envelope) {
      throw new BadRequestException(preview.reason ?? 'The NOA cannot be sent');
    }
    const call = await this.callOf(viewer, portCallId);
    if (!call.shipId) throw new BadRequestException('The port call has no ship');
    const statement = confirm || preview.confirmed ? ARRIVAL_CONFIRMATION : undefined;
    return this.sendEach(viewer, call, call.shipId, [
      {
        type: 'NOA',
        willSend: true,
        reason: null,
        envelope: preview.envelope,
        problems: [],
        previously: preview.previously,
        ...(statement ? { statement } : {}),
      },
      // The DUE with it, until NEMO has one (spec 0092)
      ...(preview.due?.envelope
        ? [
            {
              type: 'DUE' as const,
              willSend: true,
              reason: null,
              envelope: preview.due.envelope,
              problems: [],
              previously: call.formalities['DUE'] ?? null,
              lrn: preview.due.lrn,
            },
          ]
        : []),
      // Then the ticked pre-arrival reports that are ready (spec 0098)
      ...(await this.readyReports(viewer, call)),
    ]);
  }

  /** Every NOA element as a ledger row (spec 0090), with the ship's lanes and the org's cells. */
  private async ledgerOf(viewer: SessionUser, call: PortCallForNemo, snapshot: ObligationSnapshot): Promise<LedgerRow[]> {
    const ship = call.shipId ? await this.ships.get(viewer, call.shipId).catch(() => null) : null;
    return noaLedger(
      snapshot,
      ship
        ? {
            external: (ship.external ?? {}) as ShipCells['external'],
            overrides: (ship.overrides ?? {}) as unknown as ShipCells['overrides'],
            particulars: (ship.particulars ?? {}) as Record<string, unknown>,
          }
        : null,
      {
        agentId: snapshot.org.agentId ?? null,
        agencyName: snapshot.org.agencyName ?? snapshot.org.name ?? null,
        mobile: snapshot.org.agentMobile ?? null,
        email: snapshot.org.agentEmail ?? null,
        businessId: snapshot.org.businessId ?? null,
        street: snapshot.org.street ?? null,
        postcode: snapshot.org.postcode ?? null,
        city: snapshot.org.city ?? null,
        countryCode: snapshot.org.countryCode ?? null,
      },
    );
  }

  // ---- the pre-departure notice (the NOD, spec 0092) ---------------------------

  /**
   * What the NOD would carry: the four elements NEMO checks (spec 0063 ND2)
   * as ledger rows — the ETD and next port from the call, the crew and the
   * persons on board the NOA resolved (edited in place, saved as call facts).
   * It goes unconfirmed; the ATD step confirms the departure (D1's mirror).
   */
  async nodPreview(viewer: SessionUser, portCallId: string): Promise<NodPreview> {
    await this.tenantDb.withOrg(viewer.orgSlug, (client) => refreshFormFacts(client, portCallId));
    const { snapshot } = await this.portCalls.snapshotFor(viewer, portCallId);
    const call = await this.callOf(viewer, portCallId);
    const all = await this.ledgerOf(viewer, call, snapshot);
    const next = nodNextPort(snapshot);
    const rows: LedgerRow[] = [
      ...all.filter((r) => r.key === 'callCore:etd'),
      {
        key: 'callCore:nextPort', label: 'Next port of call', de: 'DE-022-08', kind: 'code', codelist: 'locode',
        owner: snapshot.nextPorts?.[0] ? 'callCore' : 'fixed', editable: false,
        externals: [], entered: null, toNemo: next, ok: true, differs: false,
      },
      ...all.filter((r) => r.key === 'call:crew' || r.key === 'call:personsOnBoard'),
    ];
    const nod = obligationsOf(snapshot).find((o) => o.code === 'NOD')!;
    const previously = call.formalities['NOD'] ?? null;
    const confirmed = !!previously?.accepted && previously.statement === DEPARTURE_CONFIRMATION;
    const { declarant } = await this.declarantOf(viewer.orgSlug);
    let reason: string | null = null;
    if (!call.visitId) reason = 'Create the port call in NEMO first (VID)';
    else if (call.formalities['ATD']?.accepted) reason = 'The departure is reported (ATD): NEMO takes no more changes to the NOD';
    else if (!declarant) reason = 'Set the EORI in NEMO declarant details first — it names your organisation on every report';
    else if (nod.missing.length > 0) reason = `Still missing: ${nod.missing.join(', ')}`;
    const envelope = !reason
      ? buildMaiEnvelope({ formalityType: 'NOD', declarant: declarant!, visitId: call.visitId!, payload: buildNodPayload(snapshot, confirmed) })
      : null;
    const problems = envelope ? this.validator.validate('NOD', envelope) : [];
    if (!reason && problems.length > 0) reason = 'The NOD does not pass the MIG schema check';
    return {
      portCallId,
      visitId: call.visitId,
      rows,
      missing: nod.missing,
      willSend: !reason,
      reason,
      envelope,
      problems,
      previously,
      confirmed,
    };
  }

  /** Sends the NOD (a first send or the update of the earlier one), unconfirmed unless it already was. */
  async sendNod(viewer: SessionUser, portCallId: string): Promise<ShipSendReceipt> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const preview = await this.nodPreview(viewer, portCallId);
    if (!preview.willSend || !preview.envelope) throw new BadRequestException(preview.reason ?? 'The NOD cannot be sent');
    const call = await this.callOf(viewer, portCallId);
    if (!call.shipId) throw new BadRequestException('The port call has no ship');
    return this.sendEach(viewer, call, call.shipId, [
      {
        type: 'NOD',
        willSend: true,
        reason: null,
        envelope: preview.envelope,
        problems: [],
        previously: preview.previously,
        ...(preview.confirmed ? { statement: DEPARTURE_CONFIRMATION } : {}),
      },
    ]);
  }

  // ---- the actual departure (the ATD, spec 0092) --------------------------------

  /**
   * The ATD step for departure time `at`: NEMO's order first (the NOD and the
   * ATA accepted), then the NOD's departure confirmation (ST-FI-02) as a NOD
   * update when it is missing, then the ATD.
   */
  async atdPreview(viewer: SessionUser, portCallId: string, at: string): Promise<ActualPreview> {
    const { row, snapshot } = await this.portCalls.snapshotFor(viewer, portCallId);
    const call = await this.callOf(viewer, portCallId);
    const nodFact = call.formalities['NOD'] ?? null;
    const confirmsNotice = !!nodFact?.accepted && nodFact.statement !== DEPARTURE_CONFIRMATION;
    const { declarant } = await this.declarantOf(viewer.orgSlug);
    let reason: string | null = null;
    if (!call.visitId) reason = 'Create the port call in NEMO first (VID)';
    else if (!call.formalities['ATA']?.accepted) reason = 'Send the ATA first — NEMO takes the departure only after the arrival';
    else if (!nodFact?.accepted) reason = 'Send the NOD first — NEMO takes the ATD only after it';
    else if (!declarant) reason = 'Set the EORI in NEMO declarant details first — it names your organisation on every report';
    else if (Date.parse(at) > Date.now() + 10 * 60_000) reason = 'The departure time is in the future';
    else if (snapshot.ata && Date.parse(at) < Date.parse(snapshot.ata)) reason = 'The departure is before the arrival';
    let noticeEnvelope: Record<string, unknown> | null = null;
    const problems: MigValidationError[] = [];
    if (!reason && confirmsNotice) {
      noticeEnvelope = buildMaiEnvelope({ formalityType: 'NOD', declarant: declarant!, visitId: call.visitId!, payload: buildNodPayload(snapshot, true) });
      problems.push(...this.validator.validate('NOD', noticeEnvelope));
    }
    const envelope = !reason
      ? buildMaiEnvelope({ formalityType: 'ATD', declarant: declarant!, visitId: call.visitId!, payload: buildAtdPayload(at) })
      : null;
    if (envelope) problems.push(...this.validator.validate('ATD', envelope));
    if (!reason && problems.length > 0) reason = 'The ATD does not pass the MIG schema check';
    return {
      portCallId,
      visitId: call.visitId,
      at,
      planned: snapshot.etd,
      berth: snapshot.berth,
      willSend: !reason,
      reason,
      confirmsNotice,
      sources: row.actualSources.atd,
      envelope,
      noticeEnvelope,
      problems,
      previously: call.formalities['ATD'] ?? null,
    };
  }

  /** Sends the ATD step: the NOD's confirmation first when missing — refused, the ATD is not tried — then the ATD. */
  async sendAtd(viewer: SessionUser, portCallId: string, at: string): Promise<ShipSendReceipt> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const preview = await this.atdPreview(viewer, portCallId, at);
    if (!preview.willSend || !preview.envelope) throw new BadRequestException(preview.reason ?? 'The ATD cannot be sent');
    let call = await this.callOf(viewer, portCallId);
    const shipId = call.shipId;
    if (!shipId) throw new BadRequestException('The port call has no ship');
    const results: FormalityReceipt[] = [];
    if (preview.confirmsNotice && preview.noticeEnvelope) {
      const first = await this.sendEach(viewer, call, shipId, [
        {
          type: 'NOD',
          willSend: true,
          reason: null,
          envelope: preview.noticeEnvelope,
          problems: [],
          previously: call.formalities['NOD'] ?? null,
          statement: DEPARTURE_CONFIRMATION,
        },
      ]);
      results.push(...first.results);
      if (!first.results.every((r) => r.accepted)) return first;
      call = await this.callOf(viewer, portCallId);
    }
    const second = await this.sendEach(viewer, call, shipId, [
      { type: 'ATD', willSend: true, reason: null, envelope: preview.envelope, problems: [], previously: preview.previously },
    ], { visitChecked: results.length > 0 });
    results.push(...second.results);
    if (second.results.every((r) => r.accepted)) {
      await this.portCalls.recordReportedActual(viewer, portCallId, 'atd', at);
    }
    return { visitId: second.visitId, sentAt: second.sentAt, results };
  }

  // ---- the actual arrival (the ATA, spec 0092) ---------------------------------

  /**
   * What the ATA step would send for arrival time `at`: NEMO's order first
   * (the NOA and the DUE accepted), then — when the NOA does not carry it
   * yet — the customs confirmation as a NOA update (D1: the ATA step
   * confirms), then the ATA. A second ATA corrects the first (NEMO takes a
   * corrected time, spec 0063).
   */
  async ataPreview(viewer: SessionUser, portCallId: string, at: string): Promise<ActualPreview> {
    const { row, snapshot } = await this.portCalls.snapshotFor(viewer, portCallId);
    const call = await this.callOf(viewer, portCallId);
    const noaFact = call.formalities['NOA'] ?? null;
    const confirmsNotice = !!noaFact?.accepted && noaFact.statement !== ARRIVAL_CONFIRMATION;
    const { declarant } = await this.declarantOf(viewer.orgSlug);
    let reason: string | null = null;
    if (!call.visitId) reason = 'Create the port call in NEMO first (VID)';
    else if (!noaFact?.accepted) reason = 'Send the NOA first — NEMO takes the ATA only after it';
    else if (!call.formalities['DUE']?.accepted) reason = 'Send the DUE first — it goes with the NOA';
    else if (!declarant) reason = 'Set the EORI in NEMO declarant details first — it names your organisation on every report';
    else if (Date.parse(at) > Date.now() + 10 * 60_000) reason = 'The arrival time is in the future';
    let noticeEnvelope: Record<string, unknown> | null = null;
    const problems: MigValidationError[] = [];
    if (!reason && confirmsNotice) {
      const noa = await this.noaPreview(viewer, portCallId, true);
      if (!noa.envelope) reason = `The NOA cannot carry the confirmation: ${noa.reason ?? 'it has gaps'}`;
      noticeEnvelope = noa.envelope;
      problems.push(...noa.problems);
    }
    const envelope = !reason
      ? buildMaiEnvelope({ formalityType: 'ATA', declarant: declarant!, visitId: call.visitId!, payload: buildAtaPayload(at) })
      : null;
    if (envelope) problems.push(...this.validator.validate('ATA', envelope));
    if (!reason && problems.length > 0) reason = 'The ATA does not pass the MIG schema check';
    return {
      portCallId,
      visitId: call.visitId,
      at,
      planned: snapshot.eta,
      berth: snapshot.berth,
      willSend: !reason,
      reason,
      confirmsNotice,
      sources: row.actualSources.ata,
      envelope,
      noticeEnvelope,
      problems,
      previously: call.formalities['ATA'] ?? null,
    };
  }

  /**
   * Sends the ATA step: the NOA's confirmation first when it is missing — if
   * NEMO refuses that, the ATA is not tried — then the ATA. An accepted ATA
   * sets the call's actual arrival here too (audited as a call update).
   */
  async sendAta(viewer: SessionUser, portCallId: string, at: string): Promise<ShipSendReceipt> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const preview = await this.ataPreview(viewer, portCallId, at);
    if (!preview.willSend || !preview.envelope) throw new BadRequestException(preview.reason ?? 'The ATA cannot be sent');
    let call = await this.callOf(viewer, portCallId);
    const shipId = call.shipId;
    if (!shipId) throw new BadRequestException('The port call has no ship');
    const results: FormalityReceipt[] = [];
    if (preview.confirmsNotice && preview.noticeEnvelope) {
      const first = await this.sendEach(viewer, call, shipId, [
        {
          type: 'NOA',
          willSend: true,
          reason: null,
          envelope: preview.noticeEnvelope,
          problems: [],
          previously: call.formalities['NOA'] ?? null,
          statement: ARRIVAL_CONFIRMATION,
        },
      ]);
      results.push(...first.results);
      if (!first.results.every((r) => r.accepted)) return first;
      call = await this.callOf(viewer, portCallId); // the NOA fact now carries the statement
    }
    const second = await this.sendEach(viewer, call, shipId, [
      { type: 'ATA', willSend: true, reason: null, envelope: preview.envelope, problems: [], previously: preview.previously },
    ], { visitChecked: results.length > 0 });
    results.push(...second.results);
    if (second.results.every((r) => r.accepted)) {
      await this.portCalls.recordReportedActual(viewer, portCallId, 'ata', at);
    }
    return { visitId: second.visitId, sentAt: second.sentAt, results };
  }

  // ---- the visit check a send dialog opens with (2026-10-06) --------------------

  /**
   * Before a send dialog opens: NEMO up and the visit alive? 'live' — go on;
   * 'unavailable' — NEMO not reached; 'unlinked' — NEMO had cancelled the
   * visit and the call is back to an unsent VID; 'notInNemo' — no visit id.
   */
  async checkVisit(
    viewer: SessionUser,
    portCallId: string,
  ): Promise<{ state: 'live' | 'unavailable' | 'unlinked' | 'notInNemo'; exchange: NemoExchange | null }> {
    assertMaySubmit(viewer); // it may unlink: an org-member act
    const call = await this.callOf(viewer, portCallId);
    if (!call.visitId) return { state: 'notInNemo', exchange: null };
    const gone = await this.visitCheck(viewer, call, 'Visit check');
    if (!gone) return { state: 'live', exchange: null };
    return { state: gone.outcome === 'unavailable' ? 'unavailable' : 'unlinked', exchange: gone };
  }

  // ---- the cancellation (the COA, spec 0080) ------------------------------------

  /**
   * Cancels the port call. In NEMO (a visit id) the COA goes first — NEMO
   * cancels the call, invalidates its VID and NOA and locks the ship data
   * (spec 0063) — and only its acceptance cancels the call here, in the same
   * transaction as the fact and the exchange; a refusal is kept on the chain
   * and said back, the call stays as it was. Not in NEMO: the soft cancel of
   * spec 0034, as before. The reason is the COA remark (DE-003-01, wanted
   * by Finland), so in NEMO it is required.
   */
  async cancel(
    viewer: SessionUser,
    portCallId: string,
    reason?: string,
  ): Promise<{ visitId: string | null; sent: boolean; exchange: NemoExchange | null }> {
    const call = await this.callOf(viewer, portCallId);
    const status = call.status ?? 'expected';
    if (!call.visitId || status === 'cancelled') {
      await this.portCalls.cancel(viewer, portCallId, reason);
      return { visitId: call.visitId, sent: false, exchange: null };
    }
    assertMaySubmit(viewer); // invariant 4: the COA is a send
    if (status === 'departed') throw new BadRequestException('A departed port call cannot be cancelled');
    // NEMO refuses the COA once the ATA is in (Fintraffic user guide, spec 0080)
    if (call.formalities['ATA']?.accepted) {
      throw new BadRequestException('NEMO does not allow cancelling a port call once its ATA (actual arrival) has been sent');
    }
    const words = reason?.trim();
    if (!words) {
      throw new BadRequestException('Give the reason — NEMO wants it on the cancellation (DE-003-01)');
    }
    const { declarant } = await this.declarantOf(viewer.orgSlug);
    if (!declarant) throw new BadRequestException('Set the EORI in NEMO declarant details first');

    const org = viewer.orgSlug;
    const visitId = call.visitId;
    // Is the visit still alive in NEMO? Cancelled there already: unlink, send nothing (2026-10-06)
    const gone = await this.visitCheck(viewer, call, 'COA');
    if (gone?.outcome === 'unavailable') throw exchangeException(503, `${gone.headline}. ${gone.explanation}`, gone);
    if (gone) return { visitId, sent: false, exchange: gone };
    const envelope = buildMaiEnvelope({
      formalityType: 'COA',
      declarant,
      visitId,
      payload: { 'coa:ExchangedDocument': { 'ram:Remarks': { $: words, '@languageID': 'EN' } } },
    });
    const problems = this.validator.validate('COA', envelope);
    if (problems.length > 0) {
      throw new UnprocessableEntityException(
        `The COA does not pass the MIG schema check: ${problems.map((p) => `${p.pointer} ${p.message}`).join('; ')}`,
      );
    }
    const documentId = documentIdOf(envelope);
    const sentAt = new Date().toISOString();
    let response: unknown = null;
    let accepted = false;
    let ackStatus: string | null = null;
    let errors: AckError[] = [];
    let httpStatus: number | null = 201;
    let failure: ReturnType<typeof explainFailure> | null = null;
    try {
      response = await this.nemo.createFormality(org, visitId, 'COA', envelope);
      const ack = parseAck(response);
      ackStatus = ack.status;
      errors = ack.errors;
      accepted = ack.status === '1';
    } catch (error) {
      // Refused, or NEMO not reached — either way kept on the chain (spec 0081)
      failure = explainFailure(error);
      httpStatus = failure.httpStatus;
      if (error instanceof NemoApiError) {
        response = error.body ? safeJson(error.body) : null;
        const ack = parseAck(response);
        ackStatus = ack.status;
        errors = ack.errors;
      }
    }
    const outcome: NemoExchange['outcome'] = accepted ? 'success' : (failure?.outcome ?? 'rejected');
    // ERR-023 "the visit is cancelled": NEMO cancelled it already (another COA,
    // the NEMO UI). The call here is unlinked from that dead visit and its VID
    // is unsent again; the old visit and its reports stay under
    // data.nemo.previousVisits and on the chain (user decision 2026-10-06).
    const alreadyCancelled = !accepted && errors.some((e) => e.code === 'ERR-023');

    const schema = await this.tenantDb.schemaFor(org);
    let auditId: string | null = null;
    await this.tenantDb.withOrg(org, async (client) => {
      if (accepted) {
        const fact: SentFact = { formalityId: null, documentId, sentAt, status: ackStatus, accepted, errors: 0, version: 1 };
        await client.query(
          `UPDATE port_call SET
             data = data || jsonb_build_object('nemo',
                      COALESCE(data->'nemo', '{}'::jsonb) || jsonb_build_object('formalities',
                        COALESCE(data->'nemo'->'formalities', '{}'::jsonb) || $2::jsonb)),
             updated = now()
           WHERE id = $1`,
          [call.id, JSON.stringify({ COA: fact })],
        );
      }
      auditId = await this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'port_call',
          entityId: call.id,
          data: {
            action: 'nemo_formality_sent',
            formalityType: 'COA',
            visitId,
            shipId: call.shipId,
            accepted,
            outcome,
            httpStatus,
            status: ackStatus,
            update: false,
            formalityId: null,
            documentId,
            // the exchange, whole (spec 0078: the NEMO log)
            errors,
            words: describe(errors, '') || (failure ? failure.headline : ''),
            request: boundedForAudit(envelope),
            response: boundedForAudit(response),
          },
          schema,
        },
        client,
      );
      if (alreadyCancelled) await this.unlinkVisit(client, viewer, call, visitId, 'ERR-023', schema);
      if (accepted) await this.portCalls.cancel(viewer, call.id, words, client);
    });
    const verdict =
      accepted || !failure || failure.outcome === 'rejected'
        ? explainVerdict({ status: ackStatus, errors, frmErrors: errors.length }, 'cancellation')
        : failure;
    const exchange: NemoExchange = {
      operation: 'COA',
      portCallId: call.id,
      visitId,
      at: sentAt,
      outcome,
      httpStatus,
      frmStatus: ackStatus,
      headline: accepted ? `NEMO cancelled the port call — ${visitId}` : verdict.headline,
      explanation: accepted ? 'NEMO invalidated the VID and every report under it.' : verdict.explanation,
      errors,
      request: envelope,
      response,
      auditId,
    };
    if (alreadyCancelled) {
      return {
        visitId,
        sent: true,
        exchange: {
          ...exchange,
          headline: `NEMO had already cancelled ${visitId}`,
          explanation:
            'NEMOLink has unlinked the port call from that visit: its VID is unsent again. ' +
            'Create it in NEMO anew if the call is still on, or cancel it here.',
        },
      };
    }
    if (!accepted) {
      const code = outcome === 'unavailable' ? 503 : 422;
      const message =
        outcome === 'unavailable'
          ? `${verdict.headline}. ${verdict.explanation}`
          : `NEMO refused the cancellation: ${describe(errors, `status ${ackStatus ?? httpStatus ?? 'unknown'}`)}`;
      throw exchangeException(code, message, exchange);
    }
    return { visitId, sent: true, exchange };
  }

  // ---- the port call in NEMO (the VID) ---------------------------------------

  /**
   * Creates the port call in NEMO through the Declarant API (spec 0063 step
   * 1). For a ship NEMO's ship database does not know (0062 F2), the
   * undocumented UI-backend route is tried while it works; when it refuses,
   * the operator gets the manual-VID words of spec 0067 §5.3.
   */
  async createInNemo(
    viewer: SessionUser,
    portCallId: string,
  ): Promise<{ visitId: string; route: string; exchange: NemoExchange }> {
    assertMaySubmit(viewer); // invariant 4: an org-member act
    const call = await this.callOf(viewer, portCallId);
    if ((call.status ?? 'expected') === 'cancelled') {
      throw new BadRequestException('This port call is cancelled');
    }
    if (call.visitId) {
      throw new ConflictException(`This port call is already in NEMO as ${call.visitId}`);
    }
    if (!call.shipId) throw new BadRequestException('The port call has no ship');
    const ship = await this.ships.get(viewer, call.shipId);
    if (!ship.imoNumber) throw new BadRequestException('The ship needs an IMO number before NEMO can identify it');
    if (!call.portLocode || !call.eta) throw new BadRequestException('The port call needs a port and an ETA');

    // The VID carries the bare minimum (spec 0082): the ship by name and IMO,
    // the port and the times. The ship's full data follows as SID + SHP.
    const identity = {
      shipName: nemoShipName(ship.name ?? ''),
      shipImoNumber: ship.imoNumber,
      eta: call.eta,
      ...(call.etd ? { etd: call.etd } : {}),
      portLocationCode: call.portLocode,
    };
    const org = viewer.orgSlug;
    const at = new Date().toISOString();
    const base = { operation: 'VID', portCallId: call.id, visitId: null, at, request: identity };
    let visitId: string | null = null;
    let route = 'declarant-api';
    let reply: unknown = null;
    try {
      const ack = await this.nemo.createPortCall(org, identity);
      reply = ack;
      const parsed = parseAck(ack);
      visitId = extractVisitId(ack);
      if (parsed.status !== '1' || !visitId) {
        const verdict = explainVerdict(parsed, 'port call');
        await this.refuse(viewer, call, 422, `NEMO did not accept the port call: ${describe(parsed.errors, `status ${parsed.status ?? 'unknown'}`)}`, {
          ...base,
          ...verdict,
          outcome: 'rejected',
          visitId,
          httpStatus: 201,
          frmStatus: parsed.status,
          errors: parsed.errors,
          response: ack,
        }, false);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof NemoApiError && !isUnavailable(error) && error.stage === 'api') {
        const body = safeJson(error.body);
        const parsed = parseAck(body);
        // The live 400 wraps the FRM in `frmResponse` (spec 0078): a ship NEMO does
        // not know is status 8 with nothing reported, whatever the wrapper says.
        const shipUnknown = error.status === 400 && parsed.status === '8' && parsed.frmErrors === 0;
        const answered = { ...base, httpStatus: error.status, frmStatus: parsed.status, errors: parsed.errors, response: body };
        if (!shipUnknown) {
          const failure = explainFailure(error);
          const verdict = error.status === 400 ? explainVerdict(parsed, 'port call') : failure;
          await this.refuse(
            viewer,
            call,
            error.status === 400 ? 422 : 502,
            error.status === 400
              ? `NEMO refused the port call: ${describe(parsed.errors, error.message)}`
              : `NEMO answered ${error.status}${describe(parsed.errors, '') ? `: ${describe(parsed.errors, '')}` : ''}`,
            { ...answered, outcome: failure.outcome, headline: verdict.headline, explanation: verdict.explanation },
            false,
          );
        }
        // 0062 F3: the UI's own route creates the ship with the call — undocumented, while it works.
        try {
          const res = (await this.nemo.createPortCallViaUiBackend(org, identity)) as Record<string, unknown> | null;
          reply = res;
          visitId =
            (typeof res?.['visitId'] === 'string' ? (res['visitId'] as string) : null) ?? extractVisitId(res);
          route = 'ui-backend';
        } catch {
          visitId = null;
        }
        if (!visitId) {
          const words = manualOnboardingWords(this.nemo.uiUrl);
          await this.refuse(viewer, call, 422, words, {
            ...answered,
            outcome: 'rejected',
            headline: 'NEMO does not know this ship',
            explanation: words,
          }, true);
        }
      } else {
        // NEMO down, its sign-in down, or no connection: nothing reached NEMO (spec 0081)
        const failure = explainFailure(error);
        const body = error instanceof NemoApiError && error.body ? safeJson(error.body) : null;
        await this.refuse(viewer, call, 503, `${failure.headline}. ${failure.explanation}`, {
          ...base,
          ...failure,
          frmStatus: null,
          errors: [],
          response: body,
        }, false);
      }
    }

    const schema = await this.tenantDb.schemaFor(org);
    const createdAt = new Date().toISOString();
    let auditId: string | null = null;
    await this.tenantDb.withOrg(org, async (client) => {
      await client.query(
        `UPDATE port_call SET
           visit_id = $2,
           data = data || jsonb_build_object('nemo', COALESCE(data->'nemo', '{}'::jsonb) || $3::jsonb),
           updated = now()
         WHERE id = $1`,
        [call.id, visitId, JSON.stringify({ createdAt, createdBy: senderOf(viewer), route })],
      );
      auditId = await this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'port_call',
          entityId: call.id,
          data: {
            action: 'nemo_port_call_created',
            visitId,
            route,
            shipId: call.shipId,
            // the exchange, whole (spec 0078: the NEMO log)
            request: boundedForAudit(identity),
            response: boundedForAudit(reply),
          },
          schema,
        },
        client,
      );
    });
    const exchange: NemoExchange = {
      ...base,
      visitId,
      outcome: 'success',
      httpStatus: route === 'ui-backend' ? 200 : 201,
      frmStatus: route === 'ui-backend' ? null : '1',
      headline: `NEMO created the port call — ${visitId!}`,
      explanation:
        route === 'ui-backend' ? 'Created through the NEMO user interface\'s own route, which also created the ship.' : '',
      errors: [],
      response: reply,
      auditId,
    };
    return { visitId: visitId!, route, exchange };
  }

  /**
   * A create NEMO did not carry out — refused, or NEMO unreachable: the
   * exchange goes on the port call's chain whole (spec 0078: the NEMO log),
   * then the caller hears the words and gets the exchange for the result
   * viewer (spec 0081).
   */
  private async refuse(
    viewer: SessionUser,
    call: { id: string; shipId: string | null },
    httpStatus: number,
    message: string,
    exchange: Omit<NemoExchange, 'auditId'>,
    shipUnknown: boolean,
  ): Promise<never> {
    const schema = await this.tenantDb.schemaFor(viewer.orgSlug);
    const auditId = await this.tenantDb.withOrg(viewer.orgSlug, (client) =>
      this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'port_call',
          entityId: call.id,
          data: {
            action: 'nemo_port_call_refused',
            shipId: call.shipId,
            outcome: exchange.outcome,
            httpStatus: exchange.httpStatus,
            frmStatus: exchange.frmStatus,
            shipUnknown,
            errors: exchange.errors,
            words: describe(exchange.errors, '') || exchange.headline,
            request: boundedForAudit(exchange.request),
            response: boundedForAudit(exchange.response),
          },
          schema,
        },
        client,
      ),
    );
    throw exchangeException(httpStatus, message, { ...exchange, auditId });
  }

  // ---- helpers -----------------------------------------------------------------

  /**
   * The MAI declarant block (spec 0038/0062 F8). NEMO checks the EORI against
   * the organisation the key belongs to (EORI_DOES_NOT_MATCH, live 2026-09-25),
   * so the id follows the key — 'FI' + its client id when that is a Y-tunnus —
   * and the org's own EORI is the fallback; the name is the agency name.
   */
  private async declarantOf(orgSlug: string): Promise<{ declarant: MaiDeclarant | null; note: string }> {
    const row = await this.tenantDb.platform((client) =>
      client.query<{ name: string; eori: string | null; data: Record<string, unknown> }>(
        `SELECT name, eori, data FROM platform.organization WHERE slug = $1 AND is_active`,
        [orgSlug],
      ),
    );
    const org = row.rows[0];
    const agent = agentFromData(org?.data ?? {});
    const name = agent.agencyName ?? org?.name;
    if (this.nemo.target !== 'mock') {
      try {
        const key = await this.credentials.resolve(orgSlug, this.nemo.target);
        const derived = eoriOfClientId(key.clientId);
        if (derived) {
          return {
            declarant: { id: derived, roleCode: 'AG', ...(name ? { name } : {}) },
            note: `the organisation your NEMO key belongs to (client id ${key.clientId})`,
          };
        }
      } catch {
        // no key on this target yet — the send itself will say so
      }
    }
    if (!org?.eori) return { declarant: null, note: 'no EORI yet' };
    return {
      declarant: { id: org.eori, roleCode: 'AG', ...(name ? { name } : {}) },
      note: 'your EORI from the NEMO declarant details',
    };
  }

  private async callOf(viewer: SessionUser, portCallId: string, shipId?: string): Promise<PortCallForNemo> {
    const result = await this.tenantDb.withOrg(viewer.orgSlug, (client: PoolClient) =>
      client.query<{
        id: string;
        visit_id: string | null;
        port_locode: string | null;
        eta: Date | null;
        etd: Date | null;
        status: string | null;
        ship_id: string | null;
        nemo: Record<string, unknown> | null;
      }>(
        `SELECT id, visit_id, port_locode, eta, etd, status, ship_id, data->'nemo' AS nemo
           FROM port_call WHERE id = $1 AND is_active`,
        [portCallId],
      ),
    );
    const r = result.rows[0];
    if (!r) throw new NotFoundException('No such port call');
    if (shipId && r.ship_id !== shipId) throw new BadRequestException('That port call belongs to another ship');
    const formalities = (r.nemo?.['formalities'] ?? {}) as Record<string, SentFact>;
    return {
      id: r.id,
      visitId: r.visit_id,
      portLocode: r.port_locode,
      eta: r.eta ? r.eta.toISOString() : null,
      etd: r.etd ? r.etd.toISOString() : null,
      status: r.status,
      shipId: r.ship_id,
      formalities,
      reports: (r.nemo?.['reports'] ?? {}) as Record<string, StoredChoice>,
    };
  }

  /** The outer formality id NEMO gave our document (spec 0062 F6); best effort, null when unsure. */
  private async outerIdOf(
    org: string,
    visitId: string,
    type: ShipFormalityType,
    documentId: string | null,
    lrn?: string,
  ): Promise<string | null> {
    try {
      const list = await this.nemo.getFormalities(org, visitId);
      if (!Array.isArray(list)) return null;
      const ours = list.map((item) => item as Record<string, unknown>).filter((item) => item['formalityType'] === type);
      const byDocument = ours.find((item) => documentId && documentIdOf((item['formality'] ?? {}) as Record<string, unknown>) === documentId);
      // A CRT can come many times per call: its LRN names it (spec 0084); never guess among several
      const lrnOf = (item: Record<string, unknown>) =>
        ((((item['formality'] ?? {}) as Record<string, any>)['env:Envelope'] ?? {})['mai:MAI']?.['mai:ExchangedDeclaration']?.['ram:ID'] as string | undefined);
      const byLrn = lrn ? ours.find((item) => lrnOf(item) === lrn) : undefined;
      const hit = byDocument ?? byLrn ?? (type !== 'CRT' && ours.length === 1 ? ours[0] : undefined);
      return hit && typeof hit['formalityId'] === 'string' ? (hit['formalityId'] as string) : null;
    } catch {
      return null;
    }
  }
}

/** The sender as the formality panel names them (spec 0087): the display name, else the username. */
function senderOf(user: SessionUser): string {
  return user.displayName?.trim() || user.username;
}
