/**
 * Admin-area endpoints (docs/specs/0017) — admins only, own org only.
 * The org's fleet and its way into the shared master list (spec 0068),
 * org-scoped audit log, organization info.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { z } from 'zod';
import { Authz } from '../auth/authz.decorator';
import { SessionUser } from '../auth/session.service';
import { CredentialCrypto } from '../nemo-client/credential-crypto';
import {
  CredentialStatus,
  NemoCredentialService,
  credentialRemoveSchema,
  credentialSetSchema,
} from '../nemo-client/nemo-credential.service';
import { AuditLogRow, AuditLogService } from './audit-log.service';
import { ActualPreview, NodPreview, NoaPreview, ReportPreview, ShipNemoPreview, ShipNemoService, ShipSendReceipt } from './ship-nemo.service';
import { PortCallService } from '../canonical/port-call.service';
import type { NoticeFacts } from '../canonical/obligations';
import { NemoSupportService, supportReportSchema } from './nemo-support.service';
import type { NemoExchange } from '../nemo-client/nemo-exchange';
import { OrgProfile, OrgService, orgUpdateSchema } from './org.service';
import {
  shipCreateSchema,
  shipNemoSendSchema,
  shipSearchSchema,
  shipUpdateSchema,
  shipUseSourceSchema,
} from './ship.schema';
import { ShipRow, ShipSearchHit, ShipsService } from './ships.service';

type AuthedRequest = Request & { user: SessionUser };

@Controller('ships')
@Authz('session:admin')
export class ShipsController {
  constructor(
    private readonly ships: ShipsService,
    private readonly shipNemo: ShipNemoService,
  ) {}

  /** The org's fleet (spec 0068). */
  @Get()
  async list(@Req() req: AuthedRequest): Promise<{ ships: ShipRow[] }> {
    return { ships: await this.ships.list(req.user) };
  }

  /** Search the shared master list by name or IMO (spec 0068). */
  @Get('search')
  async search(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
  ): Promise<{ hits: ShipSearchHit[] }> {
    const parsed = shipSearchSchema.safeParse({ q: q ?? '' });
    if (!parsed.success) return { hits: [] };
    return { hits: await this.ships.search(req.user, parsed.data.q) };
  }

  /** Put a master-list ship in the org's fleet (spec 0068). */
  @Post(':id/add')
  @HttpCode(200)
  async add(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ship: ShipRow }> {
    return { ship: await this.ships.addToFleet(req.user, id) };
  }

  /** Take a ship out of the org's fleet (spec 0068). */
  @Post(':id/remove')
  @HttpCode(200)
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    await this.ships.removeFromFleet(req.user, id);
    return { ok: true };
  }

  /** Create a master-list ship the search did not find, in the fleet at once (spec 0068). */
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ ship: ShipRow }> {
    const parsed = shipCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid ship');
    }
    return { ship: await this.ships.create(req.user, parsed.data) };
  }

  @Post(':id/update')
  @HttpCode(200)
  async update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ship: ShipRow }> {
    const parsed = shipUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid ship');
    }
    return { ship: await this.ships.update(req.user, id, parsed.data) };
  }

  @Post(':id/use-source')
  @HttpCode(200)
  async useSource(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ship: ShipRow }> {
    const parsed = shipUseSourceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    return { ship: await this.ships.useSource(req.user, id, parsed.data.field) };
  }

  /** Read the ship back from NEMO's ship database into the "In NEMO" column (spec 0064). */
  @Post(':id/nemo-refresh')
  @HttpCode(200)
  async nemoRefresh(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ship: ShipRow }> {
    return { ship: await this.ships.refreshFromNemo(req.user, id) };
  }

  /** The confirmation: what a ship-data send would carry, each field with its NEMO id (spec 0070). */
  @Get(':id/nemo-preview')
  async nemoPreview(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('portCallId') portCallId?: string,
  ): Promise<{ preview: ShipNemoPreview }> {
    const callId = portCallId && /^[0-9a-f-]{36}$/i.test(portCallId) ? portCallId : undefined;
    return { preview: await this.shipNemo.preview(req.user, id, callId) };
  }

  /** Send the ship data to NEMO as the SID and SHP of a port call (spec 0070). */
  @Post(':id/nemo-send')
  @HttpCode(200)
  async nemoSend(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ receipt: ShipSendReceipt }> {
    const parsed = shipNemoSendSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    return { receipt: await this.shipNemo.send(req.user, id, parsed.data.portCallId, parsed.data.types) };
  }
}

const portCallCancelSchema = z.object({ reason: z.string().max(500).optional() }).strict();

/** The port call's own life in NEMO — the VID (spec 0070) and the COA (spec 0080). */
@Controller('portcalls')
@Authz('session:admin')
export class PortCallNemoController {
  constructor(
    private readonly shipNemo: ShipNemoService,
    private readonly portCalls: PortCallService,
    private readonly ships: ShipsService,
    private readonly org: OrgService,
  ) {}

  /** The NOA wizard (spec 0088): checklist, envelope, whether it may be confirmed. */
  @Get(':id/noa')
  async noa(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('confirm') confirm?: string,
  ): Promise<NoaPreview> {
    return this.shipNemo.noaPreview(req.user, id, confirm === 'true');
  }

  /** The per-call NOA facts (spec 0088): purpose, draught, crew, persons on board, master, voyage type. */
  @Post(':id/noa/facts')
  @HttpCode(200)
  async noaFacts(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ notice: NoticeFacts }> {
    const parsed = noticeFactsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    return { notice: await this.portCalls.setNotice(req.user, id, parsed.data) };
  }

  /**
   * One NOA row edited in place (spec 0090): the row's owner decides where it
   * saves — a call fact on the call, a ship field as the organisation's
   * override (spec 0086: the external value itself clears it), an organisation
   * setting in the settings. Each goes through that owner's own rules.
   */
  @Post(':id/noa/field')
  @HttpCode(200)
  async noaField(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = ledgerFieldSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Name the field and its value');
    const [owner, field] = parsed.data.key.split(':') as [string, string];
    const value = parsed.data.value === '' ? null : parsed.data.value;
    const invalid = (issues: { message: string }[]) =>
      new BadRequestException(issues[0]?.message ?? 'Not a valid value');
    if (owner === 'call') {
      const facts = noticeFactsSchema.safeParse({ [field]: value });
      if (!facts.success) throw invalid(facts.error.issues);
      await this.portCalls.setNotice(req.user, id, facts.data);
    } else if (owner === 'ship') {
      // Saved to the ship's own data (user 2026-11-13): the next call has it too
      const { row } = await this.portCalls.snapshotFor(req.user, id);
      if (!row.shipId) throw new BadRequestException('The port call has no ship');
      const update = shipUpdateSchema.safeParse(shipFieldUpdate(field, value));
      if (!update.success) throw invalid(update.error.issues);
      await this.ships.update(req.user, row.shipId, update.data);
    } else if (owner === 'org') {
      // Saved to the organisation settings (user 2026-11-13). The business id
      // and the EORI are the organisation's own columns; the rest is the agent block
      const update = orgUpdateSchema.safeParse(
        field === 'businessId' || field === 'eori' ? { [field]: value } : { agent: { [field]: value } },
      );
      if (!update.success) throw invalid(update.error.issues);
      await this.org.update(req.user, update.data);
    } else if (owner === 'callCore' && (field === 'portArea' || field === 'berth')) {
      await this.savePlace(req.user, id, field, value === null ? null : String(value));
    } else {
      throw new BadRequestException('That field is not edited here');
    }
    return { ok: true };
  }

  /**
   * The place in the port (user 2026-09-30), from the port's own list: an
   * area clears a berth that is not in it; a berth sets its area too. The
   * call's edit rules and audit apply (updateManual).
   */
  private async savePlace(
    user: AuthedRequest['user'],
    id: string,
    field: 'portArea' | 'berth',
    code: string | null,
  ): Promise<void> {
    const { row } = await this.portCalls.snapshotFor(user, id);
    if (code === null) {
      await this.portCalls.updateManual(user, id, field === 'portArea' ? { portAreaCode: null, berth: null } : { berth: null });
      return;
    }
    if (!row.portLocode) throw new BadRequestException('The port call has no port');
    const areas = await this.portCalls.portAreas(user, row.portLocode);
    if (field === 'portArea') {
      const area = areas.find((a) => a.code === code);
      if (!area) throw new BadRequestException(`${code} is not a port area of ${row.portLocode}`);
      const keepBerth = !!row.berth && area.berths.some((b) => b.code === row.berth);
      // An area with one berth brings that berth (user 2026-11-13)
      const onlyBerth = area.berths.length === 1 ? area.berths[0]!.code : null;
      await this.portCalls.updateManual(user, id, keepBerth ? { portAreaCode: code } : { portAreaCode: code, berth: onlyBerth });
      return;
    }
    const area = areas.find((a) => a.berths.some((b) => b.code === code));
    if (!area) throw new BadRequestException(`${code} is not a berth of ${row.portLocode}`);
    await this.portCalls.updateManual(user, id, { portAreaCode: area.code, berth: code });
  }

  /** Tick or untick one pre-arrival report for this call (spec 0098); answers the NOA view again. */
  @Post(':id/noa/reports')
  @HttpCode(200)
  async noaReport(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<NoaPreview> {
    const parsed = noaReportSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Name the report and whether it goes: { code, on }');
    return this.shipNemo.setReportChoice(req.user, id, parsed.data.code, parsed.data.on);
  }

  /** One report that goes with the NOA, on its own (spec 0098): its data, what would go, NEMO's last refusal. */
  @Get(':id/reports/:code')
  async report(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
  ): Promise<ReportPreview> {
    if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestException('A report code is three capital letters');
    return this.shipNemo.reportPreview(req.user, id, code);
  }

  /** Send that one report again (spec 0098). */
  @Post(':id/reports/:code/send')
  @HttpCode(200)
  async reportSend(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
  ): Promise<{ receipt: ShipSendReceipt }> {
    if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestException('A report code is three capital letters');
    return { receipt: await this.shipNemo.sendReport(req.user, id, code) };
  }

  /** Send the NOA; `confirm` must be said either way — no default (user decision 2026-09-26). */
  @Post(':id/noa/send')
  @HttpCode(200)
  async noaSend(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ receipt: ShipSendReceipt }> {
    const parsed = noaSendSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException('Say whether the arrival is confirmed (ST-FI-01): confirm true or false');
    }
    return { receipt: await this.shipNemo.sendNoa(req.user, id, parsed.data.confirm) };
  }

  /** The ATA step (spec 0092): what would go for arrival time `at` (ISO; default now). */
  @Get(':id/ata')
  async ata(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('at') at?: string,
  ): Promise<ActualPreview> {
    return this.shipNemo.ataPreview(req.user, id, parseAt(at));
  }

  /** Send the ATA step: the NOA's customs confirmation first when it is missing (D1), then the ATA. */
  @Post(':id/ata/send')
  @HttpCode(200)
  async ataSend(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ receipt: ShipSendReceipt }> {
    const parsed = ataSendSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Give the arrival time (at, ISO date and time)');
    return { receipt: await this.shipNemo.sendAta(req.user, id, parseAt(parsed.data.at)) };
  }

  /** The NOD (spec 0092): the four elements NEMO checks, as ledger rows; it goes unconfirmed. */
  @Get(':id/nod')
  async nod(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<NodPreview> {
    return this.shipNemo.nodPreview(req.user, id);
  }

  @Post(':id/nod/send')
  @HttpCode(200)
  async nodSend(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<{ receipt: ShipSendReceipt }> {
    return { receipt: await this.shipNemo.sendNod(req.user, id) };
  }

  /** The ATD step (spec 0092): what would go for departure time `at` (ISO; default now). */
  @Get(':id/atd')
  async atd(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('at') at?: string,
  ): Promise<ActualPreview> {
    return this.shipNemo.atdPreview(req.user, id, parseAt(at));
  }

  /** Send the ATD step: the NOD's departure confirmation first when it is missing, then the ATD. */
  @Post(':id/atd/send')
  @HttpCode(200)
  async atdSend(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ receipt: ShipSendReceipt }> {
    const parsed = ataSendSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Give the departure time (at, ISO date and time)');
    return { receipt: await this.shipNemo.sendAtd(req.user, id, parseAt(parsed.data.at)) };
  }

  /**
   * The new ETA / ETD to NEMO (user 2026-11-13): the notices NEMO already
   * has that carry them — the NOA until the arrival, the NOD until the
   * departure — go again as updates.
   */
  @Post(':id/schedule/send')
  @HttpCode(200)
  async scheduleSend(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<{ receipt: ShipSendReceipt }> {
    return { receipt: await this.shipNemo.sendScheduleUpdate(req.user, id) };
  }

  @Post(':id/nemo-create')
  @HttpCode(200)
  async create(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ visitId: string; route: string; exchange: NemoExchange }> {
    return this.shipNemo.createInNemo(req.user, id);
  }

  /**
   * Before a send dialog opens (2026-10-06): NEMO up, the visit still alive?
   * A visit NEMO cancelled is unlinked here (the VID unsent again).
   */
  @Post(':id/nemo-check')
  @HttpCode(200)
  async nemoCheck(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ state: 'live' | 'unavailable' | 'unlinked' | 'notInNemo'; exchange: NemoExchange | null }> {
    return this.shipNemo.checkVisit(req.user, id);
  }

  /**
   * Cancel the port call: the COA when it is in NEMO (spec 0080), the soft
   * cancel of spec 0034 otherwise. `coaSent` says which.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; coaSent: boolean; exchange: NemoExchange | null }> {
    const parsed = portCallCancelSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    const out = await this.shipNemo.cancel(req.user, id, parsed.data.reason);
    return { ok: true, coaSent: out.sent, exchange: out.exchange };
  }
}

/** UN/EDIFACT 8025 purposes the NOA takes (vendored MIG enum). */
const CALL_PURPOSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '98'] as const;

export const noticeFactsSchema = z
  .object({
    purposeOfCall: z.enum(CALL_PURPOSES).nullable().optional(),
    maxDraught: z.number().positive('Draught is in metres, more than 0').max(30, 'Draught is in metres').nullable().optional(),
    crew: z.number().int().min(0).max(10000).nullable().optional(),
    personsOnBoard: z.number().int().min(0).max(10000).nullable().optional(),
    masterFamilyName: z.string().trim().min(1).max(100).nullable().optional(),
    masterGivenNames: z.string().trim().min(1).max(100).nullable().optional(),
    voyageType: z.enum(['V-01', 'V-02']).nullable().optional(),
    lastPort: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'A UN/LOCODE, e.g. SEGOT').nullable().optional(),
  })
  .strict()
  .refine(
    (f) => f.crew == null || f.personsOnBoard == null || f.personsOnBoard >= f.crew,
    'Persons on board include the crew: they cannot be fewer than the crew',
  );

const noaSendSchema = z.object({ confirm: z.boolean() }).strict();

const noaReportSchema = z.object({ code: z.string().regex(/^[A-Z]{3}$/), on: z.boolean() }).strict();

const ataSendSchema = z.object({ at: z.string().min(1).max(40) }).strict();

/** An actual time (arrival or departure) from the wire: ISO, to the minute; absent means now. */
function parseAt(at: string | undefined): string {
  if (at === undefined || at === '') return new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new BadRequestException('The time is not a date and time');
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

/** The ship's identity sits beside its particulars, not in them. */
const SHIP_IDENTITY_FIELDS = new Set(['name', 'imoNumber', 'mmsi', 'callSign']);
/** Particulars NEMO takes as yes / no. */
const SHIP_YES_NO_FIELDS = new Set(['inertGasSystem', 'mainEngineAvailabilityIndicator']);
/** Particulars that are measures. */
const SHIP_NUMBER_FIELDS = new Set([
  'length', 'width', 'grossWeight', 'netWeight', 'dwt', 'summerDeadweight', 'summerDraught',
  'betweenPerpendicularsLength', 'openWaterSpeedMeasure', 'reducedGrossTonnage', 'bowThrusterPower',
  'sternThrusterPower', 'mainEnginePower',
]);

/**
 * A ship field typed into a report's list (user 2026-11-13), as the ship
 * update takes it: identity fields at the top, the rest as particulars in
 * their own types — a measure as a number, yes / no as a boolean, the ice
 * class as its code record. Anything else the schema checks as it is.
 */
export function shipFieldUpdate(field: string, value: string | number | null): Record<string, unknown> {
  let v: unknown = typeof value === 'string' ? value.trim() : value;
  if (v === '') v = null;
  if (SHIP_IDENTITY_FIELDS.has(field)) {
    if (typeof v === 'number') v = String(v);
    if (field === 'callSign' && typeof v === 'string') v = v.toUpperCase();
    if (field === 'imoNumber' && typeof v === 'string') v = v.replace(/^IMO\s*/i, '');
    return { [field]: v };
  }
  if (v !== null && SHIP_NUMBER_FIELDS.has(field) && typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    v = Number.isFinite(n) ? n : v;
  }
  if (v !== null && SHIP_YES_NO_FIELDS.has(field) && typeof v === 'string') {
    const yes = ['yes', 'true', '1'].includes(v.toLowerCase());
    const no = ['no', 'false', '0'].includes(v.toLowerCase());
    v = yes ? true : no ? false : v;
  }
  if (v !== null && field === 'iceClass' && typeof v === 'string') v = { code: v };
  return { particulars: { [field]: v } };
}

/** One ledger row's new value (spec 0090): owner:field and the value, null clears. */
const ledgerFieldSchema = z
  .object({
    key: z.string().regex(/^(call|ship|org|callCore):[A-Za-z]+$/),
    value: z.union([z.string().max(200), z.number(), z.null()]),
  })
  .strict();

/** "Send to NEMOLink support" from the result viewer (spec 0081). */
@Controller('nemo')
@Authz('session:admin')
export class NemoSupportController {
  constructor(private readonly support: NemoSupportService) {}

  @Post('support-report')
  @HttpCode(200)
  async report(@Req() req: AuthedRequest, @Body() body: unknown): Promise<{ sentTo: string; cc: string }> {
    const parsed = supportReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid report');
    }
    return this.support.report(req.user, parsed.data);
  }
}

@Controller('audit')
@Authz('session:admin')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
  ): Promise<{ events: AuditLogRow[]; nextBefore: string | null }> {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const cursor = before && !Number.isNaN(Date.parse(before)) ? before : null;
    const query = (q ?? '').trim().slice(0, 200) || null;
    return this.auditLog.list(req.user, cursor, n, query, kind === 'nemo' ? 'nemo' : null);
  }
}

@Controller('org')
@Authz('session:admin')
export class OrgController {
  constructor(
    private readonly orgs: OrgService,
    private readonly config: ConfigService,
    private readonly nemoCredentials: NemoCredentialService,
    private readonly vault: CredentialCrypto,
  ) {}

  private ssoConfigured(entraTenantId: string | null): boolean {
    const str = (key: string): string | undefined => {
      const value = this.config.get<string>(key);
      return value ? value : undefined;
    };
    return !!(
      str('ENTRA_TENANT_ID') &&
      str('ENTRA_CLIENT_ID') &&
      str('ENTRA_CLIENT_SECRET') &&
      entraTenantId
    );
  }

  @Get()
  async get(
    @Req() req: AuthedRequest,
  ): Promise<{ org: OrgProfile & { ssoConfigured: boolean } }> {
    const profile = await this.orgs.profile(req.user);
    return {
      org: { ...profile, ssoConfigured: this.ssoConfigured(profile.entraTenantId) },
    };
  }

  /** Declarant profile edit (docs/specs/0038) — merge per field, null clears. */
  @Post('update')
  @HttpCode(200)
  async update(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ org: OrgProfile & { ssoConfigured: boolean } }> {
    const parsed = orgUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid organization profile',
      );
    }
    const profile = await this.orgs.update(req.user, parsed.data);
    return {
      org: { ...profile, ssoConfigured: this.ssoConfigured(profile.entraTenantId) },
    };
  }

  // ---- customer NEMO credentials (docs/specs/0059) -------------------------
  // The org's own NEMO key, entered by their admin. Nothing here ever returns
  // the client id or the secret: once stored, "replace" is the only edit.

  @Get('nemo-credential')
  async listNemoCredentials(
    @Req() req: AuthedRequest,
  ): Promise<{ credentials: CredentialStatus[]; vaultConfigured: boolean }> {
    return {
      credentials: await this.nemoCredentials.status(req.user.orgSlug),
      // Lets the UI say "the vault is not set up on this deployment" instead
      // of failing at save time.
      vaultConfigured: this.vault.configured,
    };
  }

  @Post('nemo-credential')
  @HttpCode(200)
  async setNemoCredential(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ credentials: CredentialStatus[] }> {
    const parsed = credentialSetSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid NEMO credential',
      );
    }
    if (!this.vault.configured) {
      throw new ServiceUnavailableException(
        'The credential vault is not configured on this deployment (NEMO_VAULT_KEYS)',
      );
    }
    return { credentials: await this.nemoCredentials.set(req.user, parsed.data) };
  }

  @Post('nemo-credential/remove')
  @HttpCode(200)
  async removeNemoCredential(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ credentials: CredentialStatus[] }> {
    const parsed = credentialRemoveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid target');
    }
    return {
      credentials: await this.nemoCredentials.remove(req.user, parsed.data.target),
    };
  }
}
