/**
 * User creation CLI (docs/specs/0011) — dev PC or docker exec on host:
 *
 *   node dist/scripts/create-user.js <org-slug> <username> --role admin --type oidc --email user@org.com
 *   echo "S3cret..." | node dist/scripts/create-user.js <org-slug> <username> --role captain --type local --password-stdin
 *
 * Passwords only via stdin — never argv (visible in process lists), never
 * logged. OIDC users need --email (the Entra claim to match on).
 */

import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { LocalAuthService } from '../auth/local-auth.service';

// 'superadmin' = nauticAi platform admin (docs/specs/0030) — grantable ONLY
// here, never through the approval/role UI
const ROLES = ['superadmin', 'admin', 'editor', 'viewer', 'captain'];

function usage(): never {
  console.error(
    'usage: create-user.js <org-slug> <username> --role <superadmin|admin|editor|viewer|captain> ' +
      '--type <oidc|local> [--email x@y] [--display-name "N"] [--password-stdin]',
  );
  process.exit(2);
}

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--password-stdin') flags['password-stdin'] = true;
    else if (arg.startsWith('--')) flags[arg.slice(2)] = argv[++i] ?? '';
    else positional.push(arg);
  }
  const [orgSlug, username] = positional;
  const role = flags['role'];
  const authType = flags['type'];
  if (!orgSlug || !username || typeof role !== 'string' || !ROLES.includes(role)) usage();
  if (authType !== 'oidc' && authType !== 'local') usage();
  if (authType === 'oidc' && !flags['email']) usage();
  if (authType === 'local' && !flags['password-stdin']) usage();

  const passwordHash =
    authType === 'local'
      ? await (async () => {
          const password = await readStdin();
          if (password.length < 12) {
            console.error('password must be at least 12 characters');
            process.exit(2);
          }
          return LocalAuthService.hashPassword(password);
        })()
      : null;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const pool = app.get<Pool>(PG_POOL);
    const audit = app.get(AuditService);
    const org = await pool.query(
      `SELECT id FROM platform.organization WHERE slug = $1 AND is_active`,
      [orgSlug],
    );
    if (!org.rows[0]) {
      console.error(`unknown org '${orgSlug}'`);
      process.exit(1);
    }
    const inserted = await pool.query(
      `INSERT INTO platform.user_account
         (org_id, username, email, display_name, auth_type, role, password_hash, author)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'create-user-cli')
       RETURNING id`,
      [
        org.rows[0].id,
        username,
        typeof flags['email'] === 'string' ? flags['email'] : null,
        typeof flags['display-name'] === 'string' ? flags['display-name'] : null,
        authType,
        role,
        passwordHash,
      ],
    );
    const userId: string = inserted.rows[0].id;
    await audit.content({
      actorId: 'create-user-cli',
      entityType: 'user_account',
      entityId: userId,
      data: { action: 'created', org: orgSlug, username, authType, role },
    });
    console.log(JSON.stringify({ userId, org: orgSlug, username, authType, role }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
