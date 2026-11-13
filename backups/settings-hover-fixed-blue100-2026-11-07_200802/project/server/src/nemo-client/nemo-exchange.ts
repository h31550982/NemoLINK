/**
 * One exchange with NEMO, as the user sees it (spec 0081): what was asked,
 * the outcome in four words — success, rejected, unavailable, error — the
 * visit id always, NEMO's answer decoded into plain words, and the raw
 * request and response. Every user-started call to NEMO returns one, whether
 * NEMO accepted, refused, or could not be reached; the UI shows it in the
 * result viewer and can send it to NEMOLink support.
 */
import type { AckError, ParsedAck } from '../canonical/ship-formalities';
import { NemoApiError } from './nemo-client.service';
import type { ReadBack } from './read-back';

export type ExchangeOutcome = 'success' | 'rejected' | 'unavailable' | 'error';

export interface NemoExchange {
  /** What was asked: 'VID', 'SID', 'SHP', 'COA', 'NSD read', … */
  operation: string;
  outcome: ExchangeOutcome;
  /** The visit id the exchange concerns — null only before NEMO gave one. */
  visitId: string | null;
  portCallId: string | null;
  /** HTTP status of NEMO's answer; null when nothing answered. */
  httpStatus: number | null;
  /** FRM status in NEMO's acknowledgement: '1' accepted, '8' rejected. */
  frmStatus: string | null;
  /** One line: what happened. */
  headline: string;
  /** Plain words: why, and what to do. */
  explanation: string;
  errors: AckError[];
  at: string;
  /** The request NEMOLink sent (the body; never a token or key). */
  request: unknown;
  /** NEMO's answer as received; null when nothing answered. */
  response: unknown;
  /** The audit event that keeps this exchange on the call's chain. */
  auditId: string | null;
  /** After an accepted send: NEMO's own copy read back and compared with ours (spec 0089). */
  readBack?: ReadBack;
}

/** HTTP statuses in words (RFC 9110 names, NEMO's meaning where known). */
const STATUS_WORDS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusWords(status: number | null): string {
  if (status === null) return 'no answer';
  const words = STATUS_WORDS[status];
  return words ? `${status} ${words}` : `HTTP ${status}`;
}

/** NEMO could not be asked or did not answer — a retry later may work, and nothing changed in NEMO. */
export function isUnavailable(error: unknown): boolean {
  if (error instanceof NemoApiError) return error.status >= 500 || error.status === 429;
  return !(error instanceof Error && error.name === 'NemoValidationError');
}

/**
 * Why a call failed before or outside NEMO's own verdict, in plain words.
 * `null` when the failure is NEMO's verdict on the content (a 400 with an
 * acknowledgement) — then the errors say it.
 */
export function explainFailure(error: unknown): { outcome: ExchangeOutcome; httpStatus: number | null; headline: string; explanation: string } {
  if (error instanceof NemoApiError) {
    const s = error.status;
    if (error.stage === 'token') {
      if (s >= 500 || s === 429) {
        return {
          outcome: 'unavailable',
          httpStatus: s,
          headline: 'NEMO is unavailable — nothing was sent',
          explanation:
            `NEMO's sign-in service answered ${statusWords(s)}, so NEMOLink could not sign in and ` +
            'nothing reached NEMO. This is a fault on NEMO\'s side; try again later.',
        };
      }
      return {
        outcome: 'error',
        httpStatus: s,
        headline: 'NEMO did not accept NEMOLink\'s key',
        explanation:
          `NEMO's sign-in service answered ${statusWords(s)}: the NEMO key (client id and secret) ` +
          'was refused. Nothing was sent. Check the NEMO key in Settings, or ask NEMOLink support.',
      };
    }
    if (s >= 500 || s === 429) {
      return {
        outcome: 'unavailable',
        httpStatus: s,
        headline: 'NEMO is unavailable — try again later',
        explanation:
          s === 429
            ? `NEMO answered ${statusWords(s)}: it is limiting requests. Wait a minute and try again.`
            : `NEMO answered ${statusWords(s)} (NEMOLink tried four times): its service is down or restarting. ` +
              'NEMO recorded nothing; try again later.',
      };
    }
    const why: Record<number, string> = {
      401: 'NEMO did not accept the sign-in. Try again; if it repeats, the NEMO key needs checking.',
      403: 'NEMO refused access: the NEMO key has no right to this, or this address is closed to API users.',
      404: 'NEMO does not know this address or visit id.',
      409: 'NEMO refused it as a conflict with what it already holds.',
    };
    return {
      outcome: s === 400 ? 'rejected' : 'error',
      httpStatus: s,
      headline: s === 400 ? 'NEMO rejected it' : `NEMO answered ${statusWords(s)}`,
      explanation: why[s] ?? `NEMO answered ${statusWords(s)}.`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    outcome: 'unavailable',
    httpStatus: null,
    headline: 'NEMO could not be reached — nothing was sent',
    explanation: `There was no connection to NEMO (${message}). Nothing reached NEMO; try again later.`,
  };
}

/** NEMO's verdict on the content, in words: accepted, or rejected with the reasons. */
export function explainVerdict(parsed: ParsedAck, operation: string): { outcome: ExchangeOutcome; headline: string; explanation: string } {
  if (parsed.status === '1') {
    return { outcome: 'success', headline: `NEMO accepted the ${operation}`, explanation: '' };
  }
  const reasons = parsed.errors.map((e) => [e.code, e.message].filter(Boolean).join(' ')).filter(Boolean);
  return {
    outcome: 'rejected',
    headline: `NEMO rejected the ${operation}`,
    explanation: reasons.length
      ? `NEMO's reasons: ${reasons.join('; ')}.`
      : 'NEMO gave no reason beyond "Bad request".',
  };
}
