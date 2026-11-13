import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { MigValidator, MigValidationError } from './mig-validator';
import {
  NemoCredentialService,
  ResolvedCredential,
} from './nemo-credential.service';
import type { components } from './generated/declarant-api';

export type NemoTarget = 'mock' | 'stg' | 'prd';

/**
 * Live STG 2026-09-24 (spec 0062 F1): the deployed API rejects
 * `registeredOwnerName` as an unsupported field although the vendored spec
 * still lists it as required. The vendored file stays as published
 * (invariant 8); our request type drops the field.
 */
export type PortCallRequestBody = Omit<
  components['schemas']['PortCallRequestBodyDTO'],
  'registeredOwnerName'
>;

/** Caller misuse detected locally — nothing was sent. */
export class NemoUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NemoUsageError';
  }
}

/** The five NEMO port-call statuses in the vendored spelling (spec 0048). */
export type NemoPortCallStatus = 'Unconfirmed' | 'Arriving' | 'Moored' | 'Departed' | 'Cancelled';
const PORT_CALL_STATUSES: NemoPortCallStatus[] = [
  'Unconfirmed',
  'Arriving',
  'Moored',
  'Departed',
  'Cancelled',
];

/**
 * The live API returns statuses UPPERCASE (`UNCONFIRMED`) while the spec, its
 * own filter and canonical/obligations spell `Unconfirmed` (spec 0062 F7).
 * Maps any casing to the vendored spelling; anything else becomes null.
 */
export function normalizePortCallStatus(raw: unknown): NemoPortCallStatus | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return PORT_CALL_STATUSES.find((status) => status.toLowerCase() === key) ?? null;
}

/** GET /v1/portcalls window, mandatory (spec 0062 F7). */
export interface PortCallListWindow {
  /** YYYY-MM-DD, inclusive, on eta */
  timeWindowStart: string;
  /** YYYY-MM-DD, inclusive, on eta */
  timeWindowEnd: string;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** NSD `searchshipid` hit: identifiers only, particulars live elsewhere. */
export interface NemoShipIdentifiers {
  /** The global NSD ship uuid (spec 0062 F9) */
  id: string;
  name: string | null;
  imoid: string | null;
  callsignid: string | null;
  mmsiid: string | null;
  eniid: string | null;
  cfrid: string | null;
  otherid: string | null;
  esdid: string | null;
}

/**
 * NSD ship record as `/nsd/api/v2/ships/{uuid}` returns it (spec 0064):
 * identifiers, the Port API `ShipData` model (the ADR 0004 spelling we
 * mirror), NSD's ice class block and certificates. Only what we read is typed.
 */
export interface NemoShipRecord {
  shipId: NemoShipIdentifiers;
  shipData: Record<string, unknown>;
  iceClass?: Record<string, unknown> | null;
  shipCertificates?: unknown[];
}

/**
 * UNDOCUMENTED wire shape of the NEMO UI backend's port call create (spec 0062
 * F3), transcribed from the UI's own request: it sends empty strings, not
 * omissions, for the identifiers it does not have.
 */
export interface UiBackendPortCallRequest {
  shipId?: string;
  shipName: string;
  shipImoNumber: string;
  mmsiNumber?: string;
  shipCallSign?: string;
  otherShipIdentificationNumber?: string;
  eta: string;
  etd?: string;
  portLocationCode: string;
  portAreaCode?: string;
  berth?: string;
}

/** Envelope failed local MIG validation — nothing was sent (invariant 4). */
export class NemoValidationError extends Error {
  constructor(
    readonly formalityType: string,
    readonly errors: MigValidationError[],
  ) {
    super(
      `${formalityType} envelope failed MIG validation (${errors.length} error(s)); not sent`,
    );
    this.name = 'NemoValidationError';
  }
}

/** Non-retryable NEMO response (4xx other than 429), or retries exhausted. */
export class NemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string,
    /** Where it failed: NEMO's sign-in service or the API itself (spec 0081). */
    readonly stage: 'token' | 'api' = 'api',
  ) {
    super(message ?? `NEMO responded ${status}`);
    this.name = 'NemoApiError';
  }
}

/**
 * Supporting services share the Declarant API's host. These prefixes come from
 * the NEMO UI's runtime config (assets/config.js) as verified on STG
 * 2026-09-24 (spec 0062); the vendored specs list only localhost servers.
 * Neither exists on the mock target.
 */
const HOST_PATHS = {
  /** Nemo Ship Database v2: read-only for a machine client. */
  nsdV2: '/nsd/api/v2',
  /**
   * Hazmat service (spec 0062 F10): confirmed live on STG 2026-09-24 and
   * named identically in the production UI config, so stg/prd need no
   * setting — NEMO_HAZMAT_URL only overrides it.
   */
  hazmatV1: '/hazmat-service/api/v1',
  /**
   * UNDOCUMENTED: the NEMO UI's own backend, not a published API. Used only
   * for what the Declarant API cannot do (spec 0062 F3/F4), to be replaced the
   * day Fintraffic offers a documented path (open question 24).
   */
  uiBackendV2: '/nemo-ui/api/v2',
} as const;

const MAX_ATTEMPTS = 4;

/**
 * The ONLY module allowed to call NEMO (invariant 4). Target selection, OAuth2
 * client-credentials token cache, required headers, MIG validation before send
 * (fail closed), retry with backoff on 429/5xx.
 *
 * Submissions are captured in the audit trail (spec 0007): a content event with
 * the exact request BEFORE the wire call (fail closed — no audit, no send) and
 * a best-effort outcome event with the NEMO response after. Structured logs here
 * carry metadata only — never payload bodies (invariant 3).
 *
 * Org-scoped since spec 0059: nauticAi holds no NEMO key of its own, so every
 * call names the org it speaks for and signs with that org's vaulted credential
 * and Agent identification number. Caches are keyed per org for the same
 * reason — two customers submitting at once must not share or evict each
 * other's token.
 */
/*
 * UI/UX STUDY COPY: this client talks to the local NEMO mock only (Prism,
 * tools/nemo-mock, the `nemo-mock` compose service). The staging and
 * production endpoints, the NEMO sign-in (token) flow and the credential
 * lookup have been removed — nothing here can reach a real NEMO.
 */
@Injectable()
export class NemoClientService {
  private readonly logger = new Logger(NemoClientService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly migValidator: MigValidator,
    private readonly audit: AuditService,
    private readonly credentials: NemoCredentialService,
  ) {}

  /** '' from compose-passed unset vars must read as absent (see notify.service). */
  private str(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return value ? value : undefined;
  }

  /** Always the local mock in this copy. */
  get target(): NemoTarget {
    return 'mock';
  }

  private get baseUrl(): string {
    return this.str('NEMO_MOCK_URL') ?? 'http://127.0.0.1:4010';
  }

  // ---- credentials + token -------------------------------------------------

  /** The mock needs no credential; the vault is never read. */
  private async credentialFor(_orgSlug: string): Promise<ResolvedCredential | null> {
    return null;
  }

  private async getToken(_orgSlug: string, _credential: ResolvedCredential | null): Promise<string> {
    return 'mock-token';
  }

  // ---- core request --------------------------------------------------------

  private async request(
    orgSlug: string,
    method: string,
    path: string,
    options: {
      query?: Record<string, string | string[]>;
      body?: string | FormData;
      contentType?: string;
      /** Base URL override for the supporting services (location/hazmat). */
      base?: string;
    } = {},
  ): Promise<unknown> {
    // Resolved once per call: the token and the organizationBusinessId header
    // must come from the same credential, and a vault or agent-id problem must
    // surface before any HTTP happens.
    const credential = await this.credentialFor(orgSlug);
    const url = new URL((options.base ?? this.baseUrl) + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      for (const v of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, v);
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      let res: Response;
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${await this.getToken(orgSlug, credential)}`,
          // The Y-tunnus of the organisation the key belongs to = its client id
          // (spec 0059 amendment 2026-09-25)
          organizationBusinessId: credential?.businessId ?? 'mock-org',
        };
        if (options.contentType) headers['Content-Type'] = options.contentType;
        res = await fetch(url, { method, headers, body: options.body ?? null });
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `[${orgSlug}] ${method} ${path} attempt ${attempt}/${MAX_ATTEMPTS} network error: ${(error as Error).message}`,
        );
        await this.backoff(attempt, null);
        continue;
      }
      const elapsed = Date.now() - started;
      if (res.ok) {
        this.logger.log(
          `[${orgSlug}] ${method} ${path} -> ${res.status} (${elapsed}ms, attempt ${attempt})`,
        );
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        this.logger.warn(
          `[${orgSlug}] ${method} ${path} -> ${res.status} (${elapsed}ms, attempt ${attempt}/${MAX_ATTEMPTS})`,
        );
        lastError = new NemoApiError(res.status, body);
        if (attempt < MAX_ATTEMPTS) {
          await this.backoff(attempt, res.headers.get('retry-after'));
          continue;
        }
      }
      // Status and time only — never the body (spec 0078: the chain keeps the exchange)
      this.logger.warn(`[${orgSlug}] ${method} ${path} -> ${res.status} (${elapsed}ms)`);
      throw new NemoApiError(res.status, body);
    }
    throw lastError ?? new Error(`[${orgSlug}] ${method} ${path} failed`);
  }

  private async backoff(attempt: number, retryAfter: string | null): Promise<void> {
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delay = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // ---- supporting reference-data services (docs/specs/0021) ----------------
  // Locations are NOT fetched here anymore: the hub publishes the full
  // dataset as a public static file, synced by refdata directly
  // (docs/specs/0027). Only the hazmat service remains.

  /**
   * Base URL for a supporting service. On stg/prd the hazmat service hangs
   * off the target's own host (HOST_PATHS.hazmatV1 — one production
   * service, confirmed 2026-09-24), so it needs no configuration;
   * NEMO_HAZMAT_URL still overrides it. The mock target has no such service:
   * its URL (the local Prism mock, tools/nemo-mock) is explicit, and a host
   * on target=mock without local mocks reads as "not configured", not a
   * failed run every cycle.
   */
  refdataBase(service: 'hazmat'): string | null {
    const configured = this.str(this.refdataUrlVar(service));
    if (configured) return configured;
    return this.target === 'mock' ? null : this.origin + HOST_PATHS.hazmatV1;
  }

  /** The env var refdataBase reads for the current target (for messages). */
  refdataUrlVar(service: 'hazmat'): string {
    const suffix = this.target === 'mock' ? '_MOCK_URL' : '_URL';
    return `NEMO_${service.toUpperCase()}${suffix}`;
  }

  /**
   * Hazmat Service: empty query body = the full dataset. Platform-level
   * reference data, but NEMO still wants a credential and we hold none of our
   * own — so the caller names the org whose key is borrowed (spec 0059 §5).
   */
  async fetchHazmatItems(orgSlug: string): Promise<unknown[]> {
    return this.fetchRefdata(orgSlug, 'hazmat', '/hazmat');
  }

  private async fetchRefdata(
    orgSlug: string,
    service: 'hazmat',
    path: string,
  ): Promise<unknown[]> {
    const base = this.refdataBase(service);
    if (!base) {
      throw new Error(
        `NEMO_TARGET=${this.target} requires ${this.refdataUrlVar(service)} for the ${service} service`,
      );
    }
    const res = await this.request(orgSlug, 'POST', path, {
      base,
      body: '{}',
      contentType: 'application/json',
    });
    if (!Array.isArray(res)) {
      throw new Error(`${service} service returned a non-array response`);
    }
    return res;
  }

  // ---- typed API -----------------------------------------------------------

  /**
   * Own port calls. A time window is mandatory (spec 0062 F7): without one the
   * live API answers from a stale set that omits the newest visits, and an
   * unknown parameter name silently returns everything, so misuse is refused
   * here, before any wire call. Statuses in the response are uppercase; see
   * normalizePortCallStatus().
   */
  async getPortCalls(
    orgSlug: string,
    window: PortCallListWindow,
    query: Record<string, string | string[]> = {},
  ): Promise<unknown> {
    for (const key of ['timeWindowStart', 'timeWindowEnd'] as const) {
      if (!ISO_DATE.test(window?.[key] ?? '')) {
        throw new NemoUsageError(`getPortCalls needs ${key} as YYYY-MM-DD (spec 0062 F7)`);
      }
    }
    return this.request(orgSlug, 'GET', '/v1/portcalls', {
      query: {
        ...query,
        timeWindowStart: window.timeWindowStart,
        timeWindowEnd: window.timeWindowEnd,
      },
    });
  }

  /** Origin of the current target; the supporting services hang off it. */
  private get origin(): string {
    return new URL(this.baseUrl).origin;
  }

  /**
   * The NEMO user interface an operator is sent to when something must be
   * done by hand there — a ship's first VID (spec 0067 §5). The UI lives at
   * the target's origin; the mock target has none.
   */
  get uiUrl(): string | null {
    return this.target === 'mock' ? null : this.origin + '/';
  }

  /**
   * Ship uuid lookup in the Nemo Ship Database (spec 0062 F9). The path is in
   * the hub's NSD OpenAPI (GET /v2/ships/searchshipid); the query parameter
   * name is not: `queryparameter` was read from the NEMO UI bundle and
   * verified live on STG 2026-09-24. Matches IMO, name, call sign or MMSI and
   * returns [] for an unknown ship. The uuid is global, one NSD record per
   * ship across organisations.
   */
  async findShips(orgSlug: string, query: string): Promise<NemoShipIdentifiers[]> {
    const res = await this.request(orgSlug, 'GET', '/ships/searchshipid', {
      base: this.origin + HOST_PATHS.nsdV2,
      query: { queryparameter: query },
    });
    return Array.isArray(res) ? (res as NemoShipIdentifiers[]) : [];
  }

  /**
   * UNDOCUMENTED: `/nsd/api/v2/ships/{uuid}` is the route the NEMO UI reads a
   * ship record with (spec 0064). The hub's NSD spec documents
   * `/ships/ship/{uuid}` instead, which answers 403 to a machine client
   * (verified 2026-09-24). Read-only; null when NSD has no such ship.
   */
  async getShip(orgSlug: string, uuid: string): Promise<NemoShipRecord | null> {
    try {
      const res = await this.request(orgSlug, 'GET', `/ships/${encodeURIComponent(uuid)}`, {
        base: this.origin + HOST_PATHS.nsdV2,
      });
      return res && typeof res === 'object' && 'shipId' in res ? (res as NemoShipRecord) : null;
    } catch (error) {
      if (error instanceof NemoApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * UNDOCUMENTED: NEMO UI backend, not a published API (spec 0062 F3). Creates
   * the port call AND the ship when NEMO does not know it, and lays out the
   * mandatory formalities as drafts; the Declarant API rejects unknown ships
   * (F2). Use only for that gap, audited like every submission, and ask
   * Fintraffic before building on it (open question 24).
   */
  async createPortCallViaUiBackend(
    orgSlug: string,
    body: UiBackendPortCallRequest,
  ): Promise<unknown> {
    return this.audited(
      orgSlug,
      { action: 'create_port_call_ui_backend', request: body, undocumented: true },
      () =>
        this.request(orgSlug, 'POST', '/portcalls', {
          base: this.origin + HOST_PATHS.uiBackendV2,
          body: JSON.stringify(body),
          contentType: 'application/json',
        }),
    );
  }

  /**
   * UNDOCUMENTED: NEMO UI backend (spec 0062 F4). The only place where the
   * automatic drafts (isMandatory, dueDate, completionState) and the ship uuid
   * of a port call are visible.
   */
  async getPortCallViaUiBackend(orgSlug: string, visitId: string): Promise<unknown> {
    return this.request(orgSlug, 'GET', `/portcalls/${encodeURIComponent(visitId)}`, {
      base: this.origin + HOST_PATHS.uiBackendV2,
    });
  }

  /**
   * UNDOCUMENTED: NEMO's own dry run (spec 0065). The NEMO UI posts a draft
   * to `/nemo-ui/api/v2/portcalls/{visitId}/validation/{TYPE}?validateMai=true`
   * and shows the answer; with a full envelope it returns the same FRM
   * acknowledgement a submission would — status 8 with every error, or 1 —
   * and submits nothing (verified 2026-09-24 with an ATA). Local MIG check
   * first, like every outbound envelope (invariant 4); not a submission, so
   * not audited as one.
   */
  async validateFormality(
    orgSlug: string,
    visitId: string,
    formalityType: string,
    envelope: Record<string, unknown>,
  ): Promise<unknown> {
    this.assertValid(formalityType, envelope);
    return this.request(
      orgSlug,
      'POST',
      `/portcalls/${encodeURIComponent(visitId)}/validation/${encodeURIComponent(formalityType.toUpperCase())}`,
      {
        base: this.origin + HOST_PATHS.uiBackendV2,
        query: { validateMai: 'true' },
        body: JSON.stringify(envelope),
        contentType: 'application/json',
      },
    );
  }

  /** Creates the port call (VID internally); acknowledgement carries the visitId. */
  async createPortCall(orgSlug: string, body: PortCallRequestBody): Promise<unknown> {
    return this.audited(orgSlug, { action: 'create_port_call', request: body }, () =>
      this.request(orgSlug, 'POST', '/v1/portcalls', {
        body: JSON.stringify(body),
        contentType: 'application/json',
      }),
    );
  }

  async getFormalities(orgSlug: string, visitId: string): Promise<unknown> {
    return this.request(
      orgSlug,
      'GET',
      `/v1/portcalls/${encodeURIComponent(visitId)}/formalities`,
    );
  }

  /**
   * Submits a formality envelope. Validates against the vendored MIG schema
   * FIRST — an invalid envelope throws NemoValidationError and nothing is sent.
   * Wire format per the vendored spec: multipart/form-data, `formalityData` part.
   * Attachments go only with a CRT (in Finland only the CRT may carry them,
   * spec 0084); `requestIceClassConfirmation` too.
   */
  async createFormality(
    orgSlug: string,
    visitId: string,
    formalityType: string,
    envelope: Record<string, unknown>,
    options: FormalityOptions = {},
  ): Promise<unknown> {
    this.assertValid(formalityType, envelope);
    this.assertAttachments(formalityType, options);
    return this.audited(
      orgSlug,
      { action: 'create_formality', visitId, formalityType, request: envelope, ...attachmentFacts(options) },
      () =>
        this.request(
          orgSlug,
          'POST',
          `/v1/portcalls/${encodeURIComponent(visitId)}/formalities/${encodeURIComponent(formalityType)}`,
          { body: formalityForm(envelope, options.attachments), ...queryOf(options) },
        ),
    );
  }

  /**
   * Live semantics (spec 0062 F6): `formalityId` is the OUTER id from the
   * formality list (it survives versions); the envelope carries PurposeCode 9
   * and a fresh document id, which is what buildMaiEnvelope produces.
   */
  async updateFormality(
    orgSlug: string,
    visitId: string,
    formalityType: string,
    formalityId: string,
    envelope: Record<string, unknown>,
    options: FormalityOptions = {},
  ): Promise<unknown> {
    this.assertValid(formalityType, envelope);
    this.assertAttachments(formalityType, options);
    return this.audited(
      orgSlug,
      {
        action: 'update_formality',
        visitId,
        formalityType,
        formalityId,
        request: envelope,
        ...attachmentFacts(options),
      },
      () =>
        this.request(
          orgSlug,
          'PUT',
          `/v1/portcalls/${encodeURIComponent(visitId)}/formalities/${encodeURIComponent(formalityType)}/${encodeURIComponent(formalityId)}`,
          { body: formalityForm(envelope, options.attachments), ...queryOf(options) },
        ),
    );
  }

  /**
   * Submission capture (spec 0007): request event first — an audit failure
   * blocks the wire call (no audit, no send). The outcome event is best effort:
   * the submission already happened, so a capture failure is logged loudly,
   * never thrown. Both events share the submission uuid as entity id.
   */
  private async audited(
    orgSlug: string,
    call: { action: string; request: unknown } & Record<string, unknown>,
    send: () => Promise<unknown>,
  ): Promise<unknown> {
    const submissionId = randomUUID();
    await this.audit.content({
      entityType: 'nemo_submission',
      entityId: submissionId,
      // orgSlug makes every call attributable to the key that made it
      // (docs/08-security.md, spec 0059)
      data: { ...call, phase: 'request', target: this.target, orgSlug },
    });
    try {
      const response = await send();
      await this.auditOutcome(submissionId, call.action, orgSlug, {
        status: 'ok',
        response,
      });
      return response;
    } catch (error) {
      const detail =
        error instanceof NemoApiError
          ? { status: 'error', httpStatus: error.status, body: error.body }
          : { status: 'error', error: error instanceof Error ? error.message : String(error) };
      await this.auditOutcome(submissionId, call.action, orgSlug, detail);
      throw error;
    }
  }

  private async auditOutcome(
    submissionId: string,
    action: string,
    orgSlug: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.content({
        entityType: 'nemo_submission',
        entityId: submissionId,
        data: { action, phase: 'outcome', target: this.target, orgSlug, ...data },
      });
    } catch (error) {
      this.logger.error(
        `audit outcome write failed for ${action} ${submissionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private assertValid(formalityType: string, envelope: Record<string, unknown>): void {
    const errors = this.migValidator.validate(formalityType, envelope);
    if (errors.length > 0) {
      // Pointers only — envelope contents may hold PII (invariant 3)
      this.logger.warn(
        `${formalityType} envelope rejected locally: ${errors
          .slice(0, 5)
          .map((e) => e.pointer || '/')
          .join(', ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`,
      );
      throw new NemoValidationError(formalityType, errors);
    }
  }

  private assertAttachments(formalityType: string, options: FormalityOptions): void {
    if ((options.attachments?.length || options.requestIceClassConfirmation) && formalityType !== 'CRT') {
      throw new NemoUsageError('In Finland only the CRT may carry attachments or ask for the ice class confirmation');
    }
  }
}

/** A file sent with a CRT (spec 0084). */
/**
 * The formality request body. Wire format: multipart/form-data whose
 * `formalityData` part MUST be typed application/json; a plain string part is
 * answered 415 (spec 0062 F5, verified live). Node's FormData only writes a
 * part content type for a Blob, hence the Blob and the file name.
 * Attachments go as raw binary parts (`format: binary`, declarant API), one
 * `attachments` part per file, byte for byte — test/nemo-multipart.spec.ts
 * holds that, and tools/stg-e2e sends these exact bytes to STG.
 */
export function formalityForm(envelope: Record<string, unknown>, attachments: FormalityAttachment[] = []): FormData {
  const form = new FormData();
  form.append(
    'formalityData',
    new Blob([JSON.stringify(envelope)], { type: 'application/json' }),
    'formalityData.json',
  );
  for (const a of attachments) {
    form.append('attachments', new Blob([new Uint8Array(a.content)], { type: a.contentType }), a.fileName);
  }
  return form;
}

export interface FormalityAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface FormalityOptions {
  attachments?: FormalityAttachment[];
  /** CRT with the CL certificate: ask Traficom to confirm the ice class (spec 0069). */
  requestIceClassConfirmation?: boolean;
}

function queryOf(options: FormalityOptions): { query?: Record<string, string> } {
  return options.requestIceClassConfirmation ? { query: { requestIceClassConfirmation: 'true' } } : {};
}

/** What the audit keeps of the files: names, types and sizes — never the bytes. */
function attachmentFacts(options: FormalityOptions): Record<string, unknown> {
  if (!options.attachments?.length && !options.requestIceClassConfirmation) return {};
  return {
    attachments: (options.attachments ?? []).map((a) => ({ fileName: a.fileName, contentType: a.contentType, bytes: a.content.length })),
    ...(options.requestIceClassConfirmation ? { requestIceClassConfirmation: true } : {}),
  };
}

/** Reads the visitId from a res:RES acknowledgement envelope; null if absent. */
export function extractVisitId(ack: unknown): string | null {
  const res = (ack as Record<string, any>)?.['env:Envelope']?.['res:RES'];
  const id = res?.['res:SpecifiedLogisticsTransportMovement']?.['ram:CallTransportEvent']?.['ram:ID'];
  return typeof id === 'string' && id ? id : null;
}
