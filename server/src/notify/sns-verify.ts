/**
 * AWS SNS message verification.
 *
 * Ported AS-IS from the prior nauticAi project (HX DDB) per
 * docs/runbooks/AWS_SETUP_WALKTHROUGH.md — "port as-is, never simplify".
 * Only the logger import is adapted to NestJS.
 *
 * The SES event webhook is reachable without a session — it has to be, SNS
 * carries no credentials — so *this* file is the access control. A caller who
 * cannot produce a signature that validates against an Amazon-hosted signing
 * certificate for the expected topic gets nothing.
 *
 * Three independent checks, all required:
 *   1. `TopicArn` equals the topic we configured (AWS_SES_EVENTS_TOPIC_ARN).
 *   2. `SigningCertURL` is an https URL on an `sns.<region>.amazonaws.com`
 *      host — otherwise an attacker could point us at a certificate they
 *      control and sign anything they like.
 *   3. The RSA signature over the canonical string matches.
 *
 * Both signature versions are accepted, each verified with its own digest:
 * version 1 is RSA-SHA1, version 2 is RSA-SHA256. Version 1 is the AWS default
 * for every SNS topic and the console does not expose the setting, so refusing
 * it would mean the endpoint could never be subscribed. The digest is bound to
 * the declared version, so a message cannot claim v1 to sidestep the v2 hash.
 */

import { createVerify, type KeyObject, createPublicKey } from 'node:crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('SnsVerify');

/** Field order is part of the signature — do not sort or reorder these. */
const NOTIFICATION_FIELDS = [
  'Message',
  'MessageId',
  'Subject',
  'Timestamp',
  'TopicArn',
  'Type',
] as const;

const SUBSCRIPTION_FIELDS = [
  'Message',
  'MessageId',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
] as const;

export interface SnsMessage {
  Type: string;
  MessageId?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  SigningCertUrl?: string;
  SubscribeURL?: string;
  Token?: string;
}

export interface SnsVerifyOptions {
  /** The only topic we accept messages from. */
  expectedTopicArn: string;
  /**
   * Certificate fetcher, injected so tests can supply a locally generated key
   * without network access. Defaults to an https GET with host validation.
   */
  fetchCertificate?: (url: string) => Promise<string>;
}

export type SnsVerifyResult = { ok: true } | { ok: false; reason: string };

/** Cached signing certificates — SNS rotates them rarely, and we re-validate the URL every time. */
const certificateCache = new Map<string, KeyObject>();

/** `sns.<region>.amazonaws.com` and nothing else. */
export function isValidSigningCertUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
}

async function defaultFetchCertificate(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Certificate fetch failed with status ${response.status}`);
  }
  return response.text();
}

/**
 * The exact byte sequence SNS signed: `field\nvalue\n` for each present field,
 * in the fixed order above.
 */
export function buildCanonicalString(message: SnsMessage): string {
  const fields =
    message.Type === 'Notification' ? NOTIFICATION_FIELDS : SUBSCRIPTION_FIELDS;
  let canonical = '';
  for (const field of fields) {
    const value = message[field as keyof SnsMessage];
    if (value === undefined) {
      continue;
    }
    canonical += `${field}\n${value}\n`;
  }
  return canonical;
}

/**
 * Everything checkable without fetching a certificate. Returns the validated
 * certificate URL, so the caller cannot proceed without having passed here.
 */
function checkEnvelope(
  message: SnsMessage,
  expectedTopicArn: string,
):
  | { ok: true; certUrl: string; algorithm: string }
  | { ok: false; reason: string } {
  if (
    message.Type !== 'Notification' &&
    message.Type !== 'SubscriptionConfirmation' &&
    message.Type !== 'UnsubscribeConfirmation'
  ) {
    return { ok: false, reason: 'unsupported message type' };
  }
  if (!message.TopicArn || message.TopicArn !== expectedTopicArn) {
    return { ok: false, reason: 'topic ARN mismatch' };
  }
  // v1 = RSA-SHA1 (the AWS default), v2 = RSA-SHA256. Anything else is not an
  // SNS signature scheme we know how to check.
  const algorithm =
    message.SignatureVersion === '1'
      ? 'RSA-SHA1'
      : message.SignatureVersion === '2'
        ? 'RSA-SHA256'
        : null;
  if (!algorithm) {
    return { ok: false, reason: 'unsupported signature version' };
  }
  const certUrl = message.SigningCertURL ?? message.SigningCertUrl;
  if (!certUrl || !isValidSigningCertUrl(certUrl)) {
    return { ok: false, reason: 'invalid signing certificate URL' };
  }
  if (!message.Signature) {
    return { ok: false, reason: 'missing signature' };
  }
  return { ok: true, certUrl, algorithm };
}

/**
 * Verify an SNS envelope. Returns a reason rather than throwing so the caller
 * can log precisely which check failed without leaking it to the sender.
 */
export async function verifySnsMessage(
  message: SnsMessage,
  options: SnsVerifyOptions,
): Promise<SnsVerifyResult> {
  const envelope = checkEnvelope(message, options.expectedTopicArn);
  if (!envelope.ok) {
    return envelope;
  }
  const { certUrl, algorithm } = envelope;
  // checkEnvelope rejects a missing signature, so this is present.
  const signature = message.Signature as string;

  let publicKey = certificateCache.get(certUrl);
  if (!publicKey) {
    try {
      const pem = await (options.fetchCertificate ?? defaultFetchCertificate)(
        certUrl,
      );
      publicKey = createPublicKey(pem);
      certificateCache.set(certUrl, publicKey);
    } catch (error) {
      logger.warn(
        `SNS signing certificate could not be loaded: ${certUrl} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return { ok: false, reason: 'signing certificate unavailable' };
    }
  }

  const verifier = createVerify(algorithm);
  verifier.update(buildCanonicalString(message), 'utf8');
  verifier.end();

  try {
    if (verifier.verify(publicKey, signature, 'base64')) {
      return { ok: true };
    }
  } catch {
    // Malformed base64 or key mismatch — indistinguishable from a bad
    // signature as far as the caller is concerned.
  }
  return { ok: false, reason: 'signature mismatch' };
}

/** Test seam — drops cached certificates. */
export function clearSigningCertificateCache(): void {
  certificateCache.clear();
}
