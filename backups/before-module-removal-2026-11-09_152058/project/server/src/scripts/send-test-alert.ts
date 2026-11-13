/**
 * Test-fires the schema-drift admin alert (docs/specs/0024) through the REAL
 * path — branded template, notify tracking, audit email events — with a
 * clearly synthetic drift entry, so the alert channel can be verified end to
 * end before a real upstream change ever happens. Run inside the server
 * container (SES env lives on the host):
 *
 *   docker exec nemolink-server node dist/scripts/send-test-alert.js [recipient]
 *
 * Recipient defaults to ADMIN_ALERT_EMAIL — running it with no argument
 * verifies the exact address real alerts will go to.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { brandedEmail } from '../notify/email-template';
import { NotifyService } from '../notify/notify.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const recipient = process.argv[2] || process.env.ADMIN_ALERT_EMAIL;
    if (!recipient) {
      console.error(
        'usage: node dist/scripts/send-test-alert.js <recipient>  (or set ADMIN_ALERT_EMAIL)',
      );
      process.exitCode = 2;
      return;
    }

    // Same composition as RefdataSyncService.maybeAlertSchemaDrift, with the
    // facts unmistakably marked as a drill.
    const { htmlBody, textBody } = brandedEmail({
      title: 'NEMO contracts changed upstream',
      paragraphs: [
        'THIS IS A TEST FIRING of the schema-drift alert (docs/specs/0024) — ' +
          'no NEMO contract has actually changed.',
        'A real alert lists the drifted sources below and means: re-run the ' +
          'vendoring fetch, review the diff, and deploy through the normal gates. ' +
          'NEMOLink keeps validating against its reviewed copies until then.',
      ],
      facts: [
        { label: 'Changed', value: '(test) openapi/declarant.json — synthetic entry' },
        { label: 'New upstream', value: '(test) NOA_9.9.9.9.json — synthetic entry' },
      ],
    });
    const notify = app.get(NotifyService);
    const result = await notify.sendTracked({
      to: recipient,
      subject: 'NEMOLink: NEMO schemas changed upstream (TEST)',
      htmlBody,
      textBody,
      template: 'schema-drift',
      relatedEntityType: 'refdata_sync',
      relatedEntityId: 'test-fire',
      author: 'send-test-alert',
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
