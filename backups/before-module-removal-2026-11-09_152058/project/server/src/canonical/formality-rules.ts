/**
 * What Finland lets a declarant do with a formality once sent (Fintraffic,
 * Declarant API guide "Update or withdraw existing formality", 2026-09-26;
 * spec 0088). Live NEMO adds one more rule on top: the NOA is locked once
 * the ATA is in (NOA_UPDATE_NOT_ALLOWED, spec 0063).
 *
 * - An update is a PUT to the formality's outer id; a withdrawn formality
 *   cannot be updated.
 * - A withdrawal carries the MAI header only, with ram:PurposeCode 1; a
 *   withdrawn formality cannot be withdrawn again.
 * - Attachments go with the CRT only, in every channel.
 */

export const UPDATABLE: ReadonlySet<string> = new Set([
  'ATA', 'ATD', 'CGA', 'CGD', 'CRT', 'CWA', 'CWD', 'DUE', 'EFF', 'HZA', 'HZD', 'MDD', 'MDH', 'MTS',
  'NOA', 'NOD', 'NOS', 'PXA', 'PXD', 'SEC', 'SID', 'SHP', 'SRV', 'SSA', 'STA', 'STD', 'WAS', 'WAR',
]);

export const WITHDRAWABLE: ReadonlySet<string> = new Set([
  'CGA', 'CGD', 'CRT', 'CWA', 'CWD', 'DUE', 'EFF', 'HZA', 'HZD', 'MDD', 'MDH', 'MTS', 'PXA', 'PXD',
  'SEC', 'SHP', 'SSA', 'STA', 'STD', 'SRV', 'WAS', 'WAR',
]);

/** Withdrawal's message function (UN/EDIFACT 1225). */
export const WITHDRAW_PURPOSE_CODE = '1';

export const mayUpdate = (type: string): boolean => UPDATABLE.has(type);
export const mayWithdraw = (type: string): boolean => WITHDRAWABLE.has(type);
