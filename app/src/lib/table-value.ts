import type { NemoColumn } from '../auth/auth';

export const TABLE_UNITS = [
  { label: 'KGM — kilogram', value: 'KGM' },
  { label: 'LTR — litre', value: 'LTR' },
  { label: 'MTQ — cubic metre', value: 'MTQ' },
  { label: 'NAR — number of articles', value: 'NAR' },
];
export const TABLE_YES_NO = [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }];

/** Matches the validation used by the table-entry dialog and the server. */
export function tableValueProblem(kind: NemoColumn['kind'] | undefined, value: string): string {
  const text = value.trim();
  if (!text) return '';
  if (kind === 'number') {
    const n = Number(text.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? '' : 'Write a number, e.g. 0.5';
  }
  if (kind === 'locode') return /^[A-Z]{2}[A-Z2-9]{3}$/.test(text.toUpperCase()) ? '' : 'A five-letter port code, e.g. FIRAU';
  if (kind === 'date') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text) ?? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    if (!m) return 'A date: yyyy-mm-dd or dd.mm.yyyy';
    const [y, mo, d] = m[1]!.length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d)
      ? '' : 'Not a real date';
  }
  return '';
}
