/**
 * Platform-admin endpoints (docs/specs/0030) — 'session:platform' only:
 * normal users (org admins included) get 403 on all of these.
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
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import { PlatformShipRow, ShipsService } from '../admin/ships.service';
import { Authz } from '../auth/authz.decorator';
import { parseCookies } from '../auth/cookies';
import { SESSION_COOKIE, SessionUser } from '../auth/session.service';
import {
  GisisStatus,
  RefdataSyncService,
  SyncRunResult,
} from '../refdata/refdata-sync.service';
import {
  PlatformAuditEvent,
  PlatformOrg,
  PlatformService,
} from './platform.service';

type AuthedRequest = Request & { user: SessionUser };

const actingOrgSchema = z
  .object({ orgSlug: z.string().min(1).max(100).nullable() })
  .strict();

/** The worldwide export runs a few MB; the FIN sample is 20 kB. */
const MAX_GISIS_UPLOAD_BYTES = 30 * 1024 * 1024;

@Controller('platform')
@Authz('session:platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly refdata: RefdataSyncService,
    private readonly ships: ShipsService,
    private readonly config: ConfigService,
  ) {}

  // ---- the master list (spec 0068) ------------------------------------------

  /** Every ship NEMOLink knows, unmasked, with the fleets it is in. */
  @Get('ships')
  async listShips(@Req() req: AuthedRequest): Promise<{ ships: PlatformShipRow[] }> {
    return { ships: await this.ships.listAll(req.user) };
  }

  /**
   * Read a master ship back from NEMO. The platform holds no key of its own,
   * so this borrows NEMO_REFDATA_ORG_SLUG's like the sync does (spec 0059 §5).
   */
  @Post('ships/:id/nemo-refresh')
  @HttpCode(200)
  async refreshShip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ship: PlatformShipRow }> {
    const borrowed = this.config.get<string>('NEMO_REFDATA_ORG_SLUG');
    if (!borrowed) {
      throw new ServiceUnavailableException(
        'No credential to borrow: set NEMO_REFDATA_ORG_SLUG (docs/specs/0059 §5)',
      );
    }
    await this.ships.refreshFromNemo(req.user, id, borrowed);
    const ship = (await this.ships.listAll(req.user)).find((s) => s.id === id);
    if (!ship) throw new BadRequestException('Unknown ship');
    return { ship };
  }

  /** Platform-wide activation (spec 0067 §2, platform admins only since 0068). */
  @Post('ships/:id/deactivate')
  @HttpCode(200)
  async deactivateShip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    await this.ships.setActive(req.user, id, false);
    return { ok: true };
  }

  @Post('ships/:id/activate')
  @HttpCode(200)
  async activateShip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    await this.ships.setActive(req.user, id, true);
    return { ok: true };
  }

  @Get('orgs')
  async orgs(): Promise<{ orgs: PlatformOrg[] }> {
    return { orgs: await this.platform.listOrgs() };
  }

  @Post('acting-org')
  @HttpCode(200)
  async actingOrg(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ user: SessionUser }> {
    const parsed = actingOrgSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('orgSlug must be a string or null');
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();
    return {
      user: await this.platform.setActingOrg(req.user, token, parsed.data.orgSlug),
    };
  }

  /** GISIS list health (docs/specs/0053): counts, last upload, staleness. */
  @Get('gisis/status')
  async gisisStatus(): Promise<{ status: GisisStatus }> {
    return { status: await this.refdata.gisisStatus() };
  }

  /**
   * Upload one GISIS Maritime Security CSV export (docs/specs/0053) —
   * per-country replace, recorded as a sync run (job 'gisis') with a
   * platform-chain audit event. GISIS sits behind a login, so this is a
   * hand-carried file, never a scheduled fetch.
   */
  @Post('gisis/upload')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_GISIS_UPLOAD_BYTES, files: 1 },
    }),
  )
  async gisisUpload(
    @Req() req: AuthedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ run: SyncRunResult }> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('Send the CSV as multipart field "file"');
    }
    const csvText = file.buffer.toString('utf8');
    return {
      run: await this.refdata.importGisis(req.user.username, csvText),
    };
  }

  @Get('audit')
  async audit(
    @Query('before') before?: string,
    @Query('q') q?: string,
  ): Promise<{ events: PlatformAuditEvent[]; nextBefore: string | null }> {
    const cursor = before && !Number.isNaN(Date.parse(before)) ? before : null;
    const query = (q ?? '').trim().slice(0, 200) || null;
    return this.platform.listAudit(cursor, query);
  }
}
