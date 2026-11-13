/**
 * Spec 0077 — the IMO check digit: one rule shared by the ship create and
 * update, the ingest envelope and the ship dialog; NEMO refuses a port
 * call for a number that fails it (BAD_REQUEST, staging 2026-09-25).
 */
import type { ZodError, ZodIssue } from 'zod';
import { IMO_CHECK_WORDS, imoCheckDigit, imoNumberSchema, imoValid } from '../src/canonical/imo';
import { shipCreateSchema, shipUpdateSchema } from '../src/admin/ship.schema';
import { envelopeSchema } from '../src/ingest/envelope.schema';

/** Every issue, the ones inside union branches too. */
function allIssues(error: ZodError): ZodIssue[] {
  const out: ZodIssue[] = [];
  const walk = (issues: ZodIssue[]): void => {
    for (const issue of issues) {
      out.push(issue);
      if (issue.code === 'invalid_union') for (const u of issue.unionErrors) walk(u.issues);
    }
  };
  walk(error.issues);
  return out;
}

describe('IMO check digit (spec 0077)', () => {
  it('computes the seventh digit from the first six', () => {
    expect(imoCheckDigit('999002')).toBe(6); // 9990026, the test ship
    expect(imoCheckDigit('123666')).toBe(8); // 1236666 was the mistyped dummy
    expect(imoCheckDigit('981100')).toBe(0); // 9811000
    expect(imoCheckDigit('12345')).toBeNull();
    expect(imoCheckDigit('12345a')).toBeNull();
  });

  it('accepts real numbers and refuses a mistyped one', () => {
    for (const ok of ['9990026', '1234567', '9811000', '9113018', '9155884', '9387425']) {
      expect(imoValid(ok)).toBe(true);
    }
    for (const bad of ['1236666', '7654321', '9000001', '123456', '12345678', 'A234567', '']) {
      expect(imoValid(bad)).toBe(false);
    }
  });

  it('the shared rule says why, without the value', () => {
    expect(imoNumberSchema.safeParse('1236668').success).toBe(true);
    const short = imoNumberSchema.safeParse('123');
    expect(short.success ? '' : short.error.issues[0]?.message).toBe('IMO number is 7 digits');
    const wrong = imoNumberSchema.safeParse('1236666');
    expect(wrong.success ? '' : wrong.error.issues[0]?.message).toBe(IMO_CHECK_WORDS);
    expect(IMO_CHECK_WORDS).not.toContain('1236666');
  });

  it('the ship create and update refuse it; null still clears', () => {
    expect(shipCreateSchema.safeParse({ name: 'Black Pearl', imoNumber: '1236668' }).success).toBe(true);
    const created = shipCreateSchema.safeParse({ name: 'Black Pearl', imoNumber: '1236666' });
    expect(created.success).toBe(false);
    expect(created.success ? '' : created.error.issues[0]?.message).toBe(IMO_CHECK_WORDS);
    expect(shipUpdateSchema.safeParse({ imoNumber: '7654321' }).success).toBe(false);
    expect(shipUpdateSchema.safeParse({ imoNumber: '7654329' }).success).toBe(true);
    expect(shipUpdateSchema.safeParse({ imoNumber: null }).success).toBe(true);
  });

  it('the ingest envelope refuses it at ship.imoNumber', () => {
    // A discriminated union: name the variant so the door reads the rest of the envelope
    const parsed = envelopeSchema.safeParse({
      payloadType: 'ship',
      ship: { imoNumber: '1236666', name: 'Black Pearl' },
    });
    expect(parsed.success).toBe(false);
    const issue = parsed.success
      ? undefined
      : allIssues(parsed.error).find((i) => i.path.join('.') === 'ship.imoNumber');
    expect(issue?.message).toBe(IMO_CHECK_WORDS);
  });
});
