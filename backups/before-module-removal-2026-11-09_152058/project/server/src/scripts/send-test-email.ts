/**
 * Manual test send (docs/specs/0003 AC 3) — run inside the server container or
 * locally, never exposed over HTTP (no auth module yet):
 *
 *   docker exec nemolink-server node dist/scripts/send-test-email.js success@simulator.amazonses.com
 *
 * SES mailbox simulator addresses (free, no reputation impact):
 *   success@simulator.amazonses.com   → Delivery event
 *   bounce@simulator.amazonses.com    → hard Bounce event (+ suppression)
 *   complaint@simulator.amazonses.com → Complaint event (+ suppression)
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotifyService } from '../notify/notify.service';

async function main(): Promise<void> {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error('usage: node dist/scripts/send-test-email.js <recipient>');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const notify = app.get(NotifyService);
    const result = await notify.sendTracked({
      to: recipient,
      subject: 'nemolink SES test',
      htmlBody:
        '<p>nemolink SES + SNS feedback loop test (docs/specs/0003).</p>',
      textBody: 'nemolink SES + SNS feedback loop test (docs/specs/0003).',
      template: 'test',
      author: 'send-test-email',
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'sent' ? 0 : 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
