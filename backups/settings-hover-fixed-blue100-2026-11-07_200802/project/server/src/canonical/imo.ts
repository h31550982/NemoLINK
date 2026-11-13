/**
 * The IMO ship identification number (spec 0077): seven digits, the seventh
 * a check digit — the first six weighted 7, 6, 5, 4, 3, 2, summed, modulo
 * 10. NEMO's Declarant API refuses a port call whose IMO fails it
 * (BAD_REQUEST, seen live on staging 2026-09-25 with 1236666), so NEMOLink
 * refuses such a number at every door where someone types it: the ship
 * create and update, the ingest envelope, the ship dialog. A value a system
 * synced (NEMO's ship database, Digitraffic) is never rejected — the ledger
 * shows the failure on the row.
 */

import { z } from 'zod';

export const IMO_RE = /^\d{7}$/;

const WEIGHTS = [7, 6, 5, 4, 3, 2] as const;

/** The check digit the first six digits call for; null unless `first6` is six digits. */
export function imoCheckDigit(first6: string): number | null {
  if (!/^\d{6}$/.test(first6)) return null;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(first6[i]) * WEIGHTS[i]!;
  return sum % 10;
}

/** Seven digits whose seventh is the check digit of the first six. */
export function imoValid(imo: string): boolean {
  return IMO_RE.test(imo) && imoCheckDigit(imo.slice(0, 6)) === Number(imo[6]);
}

/** The refusal, without the value — an ingest reply never echoes input (invariant 3). */
export const IMO_CHECK_WORDS =
  'IMO number fails its check digit — the seventh digit is computed from the first six; check the number';

/** The one IMO rule every door shares: seven digits, then the check digit. */
export const imoNumberSchema = z
  .string()
  .regex(IMO_RE, 'IMO number is 7 digits')
  .refine(imoValid, IMO_CHECK_WORDS);
