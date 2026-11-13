/**
 * Canonical port-call API (docs/specs/0026, 0034): the org-scoped list the
 * fleet view consumes, manual create/edit/cancel for admins, and the
 * operator confirm/reject of ship/log-side suggestions — the only path
 * that ever moves a port call's status.
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Body,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Authz } from '../auth/authz.decorator';
import { SessionUser } from '../auth/session.service';
import { fiLocode, nextPortSchema, prevPortSchema } from '../ingest/envelope.schema';
import {
  FleetShip,
  PortAreaOption,
  PortCallRow,
  PortCallService,
  PortInfo,
  PortOption,
  TimelineEvent,
} from './port-call.service';

type AuthedRequest = Request & { user: SessionUser };

const isoDateTime = z.string().datetime({ offset: true });

// Official cargoes (spec 0046): HS6 code + the name as picked (from the
// HS-map shortlist or the hs_cargo_item nomenclature)
// The place inside the port (spec 0048) — NEMO codes: FIRAU-BE / FIRAU-BE-BE1
const placeCode = z.string().regex(/^[A-Z]{2}[A-Z0-9-]{1,38}$/, 'not a NEMO port-area or berth code');

const cargoItemSchema = z
  .object({
    hs6: z.string().regex(/^\d{6}$/, 'hs6 must be 6 digits'),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

// The call itself is a Finnish port (spec 0037); the itinerary arrays keep
// free LOCODEs — that is exactly where the foreign ports belong.
const createSchema = z
  .object({
    shipId: z.string().uuid(),
    portLocode: fiLocode,
    portAreaCode: placeCode.optional(),
    berth: placeCode.optional(),
    eta: isoDateTime.optional(),
    etd: isoDateTime.optional(),
    voyageNumber: z.string().min(1).max(50).optional(),
    cargoDescription: z.string().max(2000).optional(),
    cargoItems: z.array(cargoItemSchema).max(50).optional(),
    prevPorts: z.array(prevPortSchema).max(10).optional(),
    nextPorts: z.array(nextPortSchema).max(10).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    portLocode: fiLocode.optional(),
    portAreaCode: placeCode.nullable().optional(),
    berth: placeCode.nullable().optional(),
    eta: isoDateTime.nullable().optional(),
    etd: isoDateTime.nullable().optional(),
    ata: isoDateTime.nullable().optional(),
    atd: isoDateTime.nullable().optional(),
    voyageNumber: z.string().min(1).max(50).nullable().optional(),
    cargoDescription: z.string().max(2000).nullable().optional(),
    cargoItems: z.array(cargoItemSchema).max(50).nullable().optional(),
    prevPorts: z.array(prevPortSchema).max(10).nullable().optional(),
    nextPorts: z.array(nextPortSchema).max(10).nullable().optional(),
  })
  .strict();

const confirmSchema = z
  .object({ field: z.enum(['ata', 'atd']), value: isoDateTime.optional() })
  .strict();

const rejectSchema = z.object({ field: z.enum(['ata', 'atd']) }).strict();

function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid request body',
      fields: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

@Controller('portcalls')
export class PortCallsController {
  constructor(private readonly portCalls: PortCallService) {}

  @Get()
  @Authz('session')
  async list(@Req() req: AuthedRequest): Promise<{ portCalls: PortCallRow[] }> {
    return { portCalls: await this.portCalls.list(req.user) };
  }

  @Get('ports')
  @Authz('session')
  async ports(
    @Req() req: AuthedRequest,
  ): Promise<{ frequent: PortOption[]; ports: PortOption[] }> {
    return this.portCalls.portOptions(req.user);
  }

  @Get('ports/:locode/areas')
  @Authz('session')
  async portAreas(
    @Req() req: AuthedRequest,
    @Param('locode') locode: string,
  ): Promise<{ areas: PortAreaOption[] }> {
    const code = locode.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z2-9]{3}$/.test(code)) {
      throw new BadRequestException('Not a UN/LOCODE');
    }
    return { areas: await this.portCalls.portAreas(req.user, code) };
  }

  /** Worldwide port search (spec 0051) — the correction picker. */
  @Get('ports/search')
  @Authz('session')
  async portSearch(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
  ): Promise<{ ports: PortOption[] }> {
    return { ports: await this.portCalls.portSearch(req.user, q ?? '') };
  }

  /** One port at a glance (spec 0051) — the document dialog's reference. */
  @Get('ports/:locode/info')
  @Authz('session')
  async portInfo(
    @Req() req: AuthedRequest,
    @Param('locode') locode: string,
  ): Promise<{ port: PortInfo }> {
    const code = locode.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z2-9]{3}$/.test(code)) {
      throw new BadRequestException('Not a UN/LOCODE');
    }
    return { port: await this.portCalls.portInfo(req.user, code) };
  }

  @Get(':id/timeline')
  @Authz('session')
  async timeline(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ events: TimelineEvent[] }> {
    return { events: await this.portCalls.timeline(req.user, id) };
  }

  @Post()
  @Authz('session:admin')
  @HttpCode(201)
  async create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    const input = parseOr400(createSchema, body);
    return { id: await this.portCalls.createManual(req.user, input) };
  }

  @Post(':id/update')
  @Authz('session:admin')
  @HttpCode(200)
  async update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const input = parseOr400(updateSchema, body);
    await this.portCalls.updateManual(req.user, id, input);
    return { ok: true };
  }

  // POST :id/cancel lives with the NEMO sends (admin PortCallNemoController,
  // spec 0080): a call in NEMO is cancelled through its COA first.

  @Post(':id/confirm')
  @Authz('session')
  @HttpCode(200)
  async confirm(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const input = parseOr400(confirmSchema, body);
    await this.portCalls.confirmActual(req.user, id, input.field, input.value);
    return { ok: true };
  }

  @Post(':id/reject')
  @Authz('session')
  @HttpCode(200)
  async reject(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const input = parseOr400(rejectSchema, body);
    await this.portCalls.rejectSuggestion(req.user, id, input.field);
    return { ok: true };
  }
}

/** Home = fleet view (docs/specs/0029): ships with their most relevant call. */
@Controller('fleet')
export class FleetController {
  constructor(private readonly portCalls: PortCallService) {}

  @Get()
  @Authz('session')
  async fleet(@Req() req: AuthedRequest): Promise<{ ships: FleetShip[] }> {
    return { ships: await this.portCalls.fleet(req.user) };
  }
}
