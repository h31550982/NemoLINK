/**
 * SES event webhook — ported from the prior nauticAi project (HX DDB), adapted
 * to NestJS. Behavior is identical:
 *
 * AWS SNS posts here with no credentials, so every request is treated as
 * hostile until `verifySnsMessage` says otherwise: topic ARN, Amazon-hosted
 * signing certificate, and RSA signature must all check out. Nothing from the
 * request body is echoed back — responses are fixed strings.
 *
 * Answers 200 to anything that parses, including events we ignore: a non-200
 * makes SNS retry, and there is nothing to gain from retrying a message we
 * cannot use.
 *
 * Authz policy 'public' by design (SNS cannot carry credentials) — the
 * signature verification IS the access control (invariant 2 satisfied).
 */

import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Authz } from '../auth/authz.decorator';
import { verifySnsMessage, type SnsMessage } from './sns-verify';
import { EmailEventsService, type SesEventPayload } from './email-events.service';

/** SNS posts JSON as text/plain, so the body may arrive as a raw string. */
function parseEnvelope(body: unknown): SnsMessage | undefined {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as SnsMessage;
    } catch {
      return undefined;
    }
  }
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    return body as SnsMessage;
  }
  return undefined;
}

@Controller('email-events')
@Authz('public')
export class EmailEventsController {
  private readonly logger = new Logger(EmailEventsController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly service: EmailEventsService,
  ) {}

  @Post('ses')
  async handleSnsNotification(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const expectedTopicArn = this.config.get<string>('AWS_SES_EVENTS_TOPIC_ARN');
    if (!expectedTopicArn) {
      // No topic configured on this instance — the endpoint is closed rather
      // than accepting whatever arrives.
      this.logger.warn(
        'SES event webhook called but AWS_SES_EVENTS_TOPIC_ARN is unset',
      );
      res.status(503).json({ success: false });
      return;
    }

    const envelope = parseEnvelope(req.body);
    if (!envelope) {
      res.status(400).json({ success: false });
      return;
    }

    const verification = await verifySnsMessage(envelope, { expectedTopicArn });
    if (!verification.ok) {
      // The reason is logged, never returned — an attacker probing the endpoint
      // learns nothing about which check rejected them. This is the line you
      // need when a subscription refuses to confirm.
      this.logger.warn(
        `Rejected SNS message: ${verification.reason} (type=${envelope.Type}, ip=${req.ip})`,
      );
      res.status(403).json({ success: false });
      return;
    }

    if (envelope.Type === 'SubscriptionConfirmation') {
      await this.confirmSubscription(envelope);
      res.status(200).json({ success: true });
      return;
    }

    if (envelope.Type === 'UnsubscribeConfirmation') {
      this.logger.warn(`SES event topic unsubscribed: ${envelope.TopicArn}`);
      res.status(200).json({ success: true });
      return;
    }

    let payload: unknown;
    try {
      payload = envelope.Message ? JSON.parse(envelope.Message) : undefined;
    } catch {
      this.logger.warn('SNS notification carried a non-JSON message');
      res.status(200).json({ success: true });
      return;
    }

    if (payload && typeof payload === 'object') {
      await this.service.ingest(payload as SesEventPayload);
    }
    res.status(200).json({ success: true });
  }

  /**
   * Confirm the subscription by visiting the SubscribeURL. Only reached after
   * the signature and topic ARN verified, so the URL genuinely came from SNS.
   */
  private async confirmSubscription(envelope: SnsMessage): Promise<void> {
    if (!envelope.SubscribeURL) {
      this.logger.warn('SNS subscription confirmation carried no SubscribeURL');
      return;
    }
    try {
      const response = await fetch(envelope.SubscribeURL, { redirect: 'error' });
      this.logger.log(
        `SES event topic subscription confirmed: ${envelope.TopicArn} (status ${response.status})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to confirm SES event topic subscription: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
