/**
 * Request forensics context (docs/specs/0033): every HTTP request runs in
 * an AsyncLocalStorage scope carrying the client IP + user agent, so
 * AuditService can stamp forensics on every event written while handling
 * the request — no threading through call sites. Only these two values
 * are captured; tokens and other headers never enter the audit trail.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestForensics {
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestForensics>();

const USER_AGENT_MAX = 256;

export function currentRequestForensics(): RequestForensics | undefined {
  const store = storage.getStore();
  return store && Object.keys(store).length > 0 ? store : undefined;
}

export function requestForensicsMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const forensics: RequestForensics = {};
  // trust proxy is configured in main.ts, so req.ip is the real client
  // behind nginx (first non-private hop of X-Forwarded-For).
  if (typeof req.ip === 'string' && req.ip) forensics.ip = req.ip;
  const userAgent = req.headers['user-agent'];
  if (typeof userAgent === 'string' && userAgent) {
    forensics.userAgent = userAgent.slice(0, USER_AGENT_MAX);
  }
  storage.run(forensics, next);
}
