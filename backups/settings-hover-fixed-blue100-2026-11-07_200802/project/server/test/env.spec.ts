/**
 * Environment validation (config/env.ts): the vault master key list must be
 * "<keyId>:<64 hex>" entries — a wrong value (a NEMO client secret pasted
 * there, say) fails the boot naming the variable and never the value
 * (spec 0059, amendment 2026-09-25).
 */
import { validateEnv } from '../src/config/env';

const BASE = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

describe('validateEnv — NEMO_VAULT_KEYS', () => {
  it('accepts an absent, empty or well-formed vault key list', () => {
    expect(validateEnv({ ...BASE }).NEMO_VAULT_KEYS).toBeUndefined();
    expect(validateEnv({ ...BASE, NEMO_VAULT_KEYS: '' }).NEMO_VAULT_KEYS).toBeUndefined();
    expect(validateEnv({ ...BASE, NEMO_VAULT_KEYS: `v1:${HEX_A}` }).NEMO_VAULT_KEYS).toBe(
      `v1:${HEX_A}`,
    );
    expect(
      validateEnv({ ...BASE, NEMO_VAULT_KEYS: `v1:${HEX_A},v0:${HEX_B}` }).NEMO_VAULT_KEYS,
    ).toBe(`v1:${HEX_A},v0:${HEX_B}`);
  });

  it('refuses anything else at boot, naming the variable and never the value', () => {
    const secret = 'S3cr3t-NEMO-client-secret-value';
    let message = '';
    try {
      validateEnv({ ...BASE, NEMO_VAULT_KEYS: secret });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Invalid environment: NEMO_VAULT_KEYS: /);
    expect(message).toMatch(/64 hex/);
    expect(message).toMatch(/never a NEMO client secret/);
    expect(message).not.toContain(secret);

    expect(() => validateEnv({ ...BASE, NEMO_VAULT_KEYS: 'v1:abcd' })).toThrow(/NEMO_VAULT_KEYS/);
    expect(() => validateEnv({ ...BASE, NEMO_VAULT_KEYS: `V1:${HEX_A}` })).toThrow(/NEMO_VAULT_KEYS/);
    expect(() => validateEnv({ ...BASE, NEMO_VAULT_KEYS: `v1:${HEX_A},` })).toThrow(/NEMO_VAULT_KEYS/);
  });
});
