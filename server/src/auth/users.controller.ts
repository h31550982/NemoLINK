/**
 * Org user management (docs/specs/0012) — admins only, own org only.
 * Pending SSO signups surface here for approve/reject.
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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Authz } from './authz.decorator';
import { SessionUser } from './session.service';
import { OrgUserRow, UserApprovalService } from './user-approval.service';

const roleSchema = z
  .object({ role: z.enum(['admin', 'editor', 'viewer', 'captain']) })
  .strict();

const shipSchema = z.object({ shipId: z.string().uuid().nullable() }).strict();

type AuthedRequest = Request & { user: SessionUser };

@Controller('users')
@Authz('session:admin')
export class UsersController {
  constructor(private readonly approval: UserApprovalService) {}

  @Get()
  async list(@Req() req: AuthedRequest): Promise<{ users: OrgUserRow[] }> {
    return { users: await this.approval.listOrgUsers(req.user) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = roleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('role must be admin|editor|viewer|captain');
    }
    await this.approval.approve(req.user, id, parsed.data.role);
    return { ok: true };
  }

  @Post(':id/role')
  @HttpCode(200)
  async changeRole(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = roleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('role must be admin|editor|viewer|captain');
    }
    await this.approval.changeRole(req.user, id, parsed.data.role);
    return { ok: true };
  }

  /** Captain ↔ ship binding (spec 0049) — scopes their calls and uploads. */
  @Post(':id/ship')
  @HttpCode(200)
  async assignShip(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = shipSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('shipId must be a ship id or null');
    }
    await this.approval.assignShip(req.user, id, parsed.data.shipId);
    return { ok: true };
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    await this.approval.reject(req.user, id);
    return { ok: true };
  }

  @Post(':id/welcome-email')
  @HttpCode(200)
  async resendWelcome(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true; status: string }> {
    const status = await this.approval.resendWelcome(req.user, id);
    return { ok: true, status };
  }
}
