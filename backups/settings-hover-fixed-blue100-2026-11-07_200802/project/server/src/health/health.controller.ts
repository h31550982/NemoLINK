import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { Authz } from '../auth/authz.decorator';
import { PG_POOL } from '../db/db.module';

// 'public' by design: status only, no data — and unreachable from the internet
// (nginx 404s it; served on the VPN port only, docs/specs/0000 amendment).
@Controller('health')
@Authz('public')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async health(): Promise<{
    app: string;
    status: 'ok';
    db: 'up' | 'down';
    time: string;
  }> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.pool.query('SELECT 1');
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      app: 'nemolink-server',
      status: 'ok',
      db,
      time: new Date().toISOString(),
    };
  }
}
