/**
 * The IMO ship identification number (spec 0077): seven digits, the seventh
 * a check digit — the first six weighted 7, 6, 5, 4, 3, 2, summed, modulo
 * 10. The same rule as the server's canonical/imo.ts: a mistyped number is
 * refused before NEMO sees it, and a synced value that fails it is shown on
 * the ledger row.
 */

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

/** Why a number is refused — with the digit it should end in, for a typo caught at the keyboard. */
export function imoWords(imo: string): string {
  if (!IMO_RE.test(imo)) return 'IMO number is 7 digits';
  const digit = imoCheckDigit(imo.slice(0, 6));
  return `IMO number ${imo} fails its check digit — for ${imo.slice(0, 6)} the seventh digit is ${digit}`;
}
