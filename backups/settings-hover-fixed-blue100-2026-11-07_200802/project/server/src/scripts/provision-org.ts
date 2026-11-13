/**
 * Tenant provisioning CLI (docs/specs/0010) — dev PC or docker exec on host:
 *
 *   node dist/scripts/provision-org.js <slug> "<name>" [--business-id X] [--eori Y]
 *
 * One transaction: org row + org_<slug> schema from schema.sql + verification
 * + platform audit event. Fails cleanly on duplicates; no partial state.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ProvisioningService } from '../tenancy/provisioning.service';

function parseArgs(argv: string[]): {
  slug: string;
  name: string;
  businessId?: string;
  eori?: string;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = argv[++i] ?? '';
    } else {
      positional.push(arg);
    }
  }
  const [slug, name] = positional;
  if (!slug || !name) {
    console.error(
      'usage: node dist/scripts/provision-org.js <slug> "<name>" [--business-id X] [--eori Y]',
    );
    process.exit(2);
  }
  return {
    slug,
    name,
    ...(flags['business-id'] ? { businessId: flags['business-id'] } : {}),
    ...(flags['eori'] ? { eori: flags['eori'] } : {}),
  };
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const provisioning = app.get(ProvisioningService);
    const result = await provisioning.provision({
      ...input,
      author: 'provision-org-cli',
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
