/**
 * Low-level AWS SES sender — ported from the prior nauticAi project (HX DDB).
 *
 * Pure send — no DB, no rate limiting, no logging. Consumers layer those on
 * top against their own DB pool.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SesConfig {
  region: string;
  fromEmail: string;
  replyToEmail?: string | undefined;
  // Credentials are optional — when omitted the SDK picks them up from
  // the EC2/ECS/Lambda IAM role automatically.
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  // Optional SES configuration set (for SNS bounce/complaint tracking).
  configurationSetName?: string | undefined;
  // Display name shown before the address.
  fromDisplayName?: string | undefined;
}

export interface RawEmailOptions {
  to: string;
  cc?: string | undefined;
  // Hidden recipients — not visible to the To/CC audience.
  bcc?: string | undefined;
  subject: string;
  htmlBody: string;
  textBody: string;
  replyTo?: string | undefined;
}

export interface RawEmailResult {
  messageId: string | undefined;
}

let cachedClient: { ses: SESClient; region: string } | null = null;

function getClient(config: SesConfig): SESClient {
  if (cachedClient && cachedClient.region === config.region) {
    return cachedClient.ses;
  }
  const ses = new SESClient({
    region: config.region,
    // Only set credentials when explicit keys are provided. Omitting the key
    // entirely lets the SDK fall back to the IAM role automatically; passing
    // `undefined` does not (and trips exactOptionalPropertyTypes).
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
  });
  cachedClient = { ses, region: config.region };
  return ses;
}

export function isEmailConfigured(
  config: Partial<SesConfig> | undefined,
): config is SesConfig {
  return !!config && !!config.region && !!config.fromEmail;
}

/**
 * Split a recipient field into individual SES addresses. Callers may pass a
 * single address or a comma-separated list; SES needs them as separate array
 * entries.
 */
function toAddressList(value: string): string[] {
  return value
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

export async function sendRawEmail(
  config: SesConfig,
  options: RawEmailOptions,
): Promise<RawEmailResult> {
  const client = getClient(config);
  const displayName = config.fromDisplayName ?? 'nauticAi NEMOLink';
  const source = `${displayName} <${config.fromEmail}>`;

  const command = new SendEmailCommand({
    Source: source,
    ...(config.configurationSetName && {
      ConfigurationSetName: config.configurationSetName,
    }),
    Destination: {
      ToAddresses: toAddressList(options.to),
      ...(options.cc && { CcAddresses: toAddressList(options.cc) }),
      ...(options.bcc && { BccAddresses: toAddressList(options.bcc) }),
    },
    Message: {
      Subject: { Data: options.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: options.htmlBody, Charset: 'UTF-8' },
        Text: { Data: options.textBody, Charset: 'UTF-8' },
      },
    },
    ReplyToAddresses: [options.replyTo ?? config.replyToEmail ?? config.fromEmail],
  });

  const result = await client.send(command);
  return { messageId: result.MessageId };
}
