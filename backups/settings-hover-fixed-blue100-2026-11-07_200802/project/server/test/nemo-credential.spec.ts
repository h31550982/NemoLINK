/**
 * Spec 0059 — per-org NEMO credential vault: encryption round-trip and
 * tamper-evidence, master-key rotation, rotation-as-insert, and the property
 * the whole design rests on — no response and no audit event ever carries the
 * client id or the secret.
 */
import type { PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import {
  CredentialCrypto,
  VaultDecryptError,
  VaultKeyMissingError,
  VaultNotConfiguredError,
  decryptSecret,
  encryptSecret,
  parseVaultKeys,
} from '../src/nemo-client/credential-crypto';
import {
  NemoCredentialMissingError,
  NemoCredentialService,
} from '../src/nemo-client/nemo-credential.service';

const KEY_V1 = 'a'.repeat(64);
const KEY_V0 = 'b'.repeat(64);
const KEYS = parseVaultKeys(`v1:${KEY_V1},v0:${KEY_V0}`);

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const CREDENTIAL_JSON = JSON.stringify({ clientId: 'nemolink-acmeship', clientSecret: 's3cr3t' });

describe('vault key parsing', () => {
  it('keeps order — the first key encrypts', () => {
    expect(KEYS.map((k) => k.keyId)).toEqual(['v1', 'v0']);
  });

  it('treats an absent value as an unconfigured vault, not an error', () => {
    expect(parseVaultKeys(undefined)).toEqual([]);
    expect(parseVaultKeys('   ')).toEqual([]);
  });

  it('refuses a malformed list rather than silently dropping an entry', () => {
    // Half a key list is how rows become undecryptable
    expect(() => parseVaultKeys('v1')).toThrow(/keyId/);
    expect(() => parseVaultKeys('v1:abcd')).toThrow(/64 hex/);
    expect(() => parseVaultKeys(`v1:${KEY_V1},v1:${KEY_V0}`)).toThrow(/twice/);
    expect(() => parseVaultKeys(`V1!:${KEY_V1}`)).toThrow(/key id/);
  });
});

describe('encryption round-trip (AC 1)', () => {
  it('decrypts back to the input under the key that wrote it', () => {
    const { ciphertext, keyId } = encryptSecret(KEYS, CREDENTIAL_JSON);
    expect(keyId).toBe('v1');
    expect(decryptSecret(KEYS, ciphertext, keyId)).toBe(CREDENTIAL_JSON);
  });

  it('never repeats a ciphertext — fresh iv per write', () => {
    const a = encryptSecret(KEYS, CREDENTIAL_JSON).ciphertext;
    const b = encryptSecret(KEYS, CREDENTIAL_JSON).ciphertext;
    expect(a.equals(b)).toBe(false);
  });

  it('never leaks the plaintext into the blob', () => {
    const { ciphertext } = encryptSecret(KEYS, CREDENTIAL_JSON);
    expect(ciphertext.toString('utf8')).not.toContain('s3cr3t');
    expect(ciphertext.toString('utf8')).not.toContain('nemolink-acmeship');
  });

  it('fails closed on a tampered byte anywhere in the blob', () => {
    const { ciphertext, keyId } = encryptSecret(KEYS, CREDENTIAL_JSON);
    for (const at of [0, 3, 20, ciphertext.length - 1]) {
      const tampered = Buffer.from(ciphertext);
      tampered[at] = (tampered[at]! ^ 0xff) & 0xff;
      expect(() => decryptSecret(KEYS, tampered, keyId)).toThrow(VaultDecryptError);
    }
  });

  it('refuses a truncated blob instead of reading past it', () => {
    const { ciphertext, keyId } = encryptSecret(KEYS, CREDENTIAL_JSON);
    expect(() => decryptSecret(KEYS, ciphertext.subarray(0, 10), keyId)).toThrow(
      VaultDecryptError,
    );
  });

  it('says so plainly when the vault is not configured', () => {
    expect(() => encryptSecret([], CREDENTIAL_JSON)).toThrow(VaultNotConfiguredError);
    expect(() => decryptSecret([], Buffer.alloc(40), 'v1')).toThrow(
      VaultNotConfiguredError,
    );
  });
});

describe('master-key rotation (AC 2)', () => {
  it('reads old rows while writing new ones under the new key', () => {
    // Written when v0 was the only key…
    const old = encryptSecret(parseVaultKeys(`v0:${KEY_V0}`), CREDENTIAL_JSON);
    expect(old.keyId).toBe('v0');
    // …still readable after v1 is prepended, and new writes use v1
    expect(decryptSecret(KEYS, old.ciphertext, old.keyId)).toBe(CREDENTIAL_JSON);
    expect(encryptSecret(KEYS, CREDENTIAL_JSON).keyId).toBe('v1');
  });

  it('names the missing key when a row outlives its master key', () => {
    const old = encryptSecret(parseVaultKeys(`v0:${KEY_V0}`), CREDENTIAL_JSON);
    const onlyV1 = parseVaultKeys(`v1:${KEY_V1}`);
    expect(() => decryptSecret(onlyV1, old.ciphertext, old.keyId)).toThrow(
      VaultKeyMissingError,
    );
  });
});

// --- service level ---------------------------------------------------------

function cryptoFor(raw: string | undefined): CredentialCrypto {
  return new CredentialCrypto({
    get: (key: string) => (key === 'NEMO_VAULT_KEYS' ? raw : undefined),
  } as never);
}

interface QueryLog {
  sql: string;
  params: unknown[];
}

/** Pool + tenant-db doubles: enough to observe the SQL and the audit call. */
function harness(opts: {
  rows?: Record<string, unknown[]>;
  vault?: string;
  replacedRowCount?: number;
} = {}) {
  const queries: QueryLog[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const answer = (sql: string): { rows: unknown[]; rowCount: number } => {
    for (const [needle, rows] of Object.entries(opts.rows ?? {})) {
      if (sql.includes(needle)) return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('UPDATE platform.nemo_credential')) {
      return { rows: [], rowCount: opts.replacedRowCount ?? 0 };
    }
    return { rows: [], rowCount: 0 };
  };

  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    return answer(sql);
  });

  const client = { query } as unknown as PoolClient;
  const tenantDb = {
    schemaFor: jest.fn(async () => 'org_acmeship'),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as TenantDb;
  const audit = {
    content: jest.fn(async (entry: Record<string, unknown>) => {
      audits.push(entry);
      return 'hash';
    }),
  } as unknown as AuditService;

  const service = new NemoCredentialService(
    { query } as never,
    // 'vault' in opts distinguishes "not specified" from "deliberately unset"
    cryptoFor('vault' in opts ? opts.vault : `v1:${KEY_V1}`),
    tenantDb,
    audit,
  );
  return { service, queries, audits, query };
}

describe('resolve — fails closed, and distinctly (AC 6)', () => {
  it('returns the credential with the header identity = the key\'s own client id', async () => {
    const { ciphertext, keyId } = encryptSecret(KEYS, CREDENTIAL_JSON);
    const { service } = harness({
      vault: `v1:${KEY_V1},v0:${KEY_V0}`,
      rows: {
        'LEFT JOIN platform.nemo_credential': [
          { business_id: '7654322-9', ciphertext, key_id: keyId },
        ],
      },
    });
    await expect(service.resolve('acmeship', 'stg')).resolves.toEqual({
      clientId: 'nemolink-acmeship',
      clientSecret: 's3cr3t',
      businessId: 'nemolink-acmeship',
    });
  });

  it('a missing key fails closed; an org without a Y-tunnus of its own still resolves — the header follows the key (spec 0059 amendment 2026-09-25)', async () => {
    const noKey = harness({
      rows: {
        'LEFT JOIN platform.nemo_credential': [
          { business_id: '7654322-9', ciphertext: null, key_id: null },
        ],
      },
    });
    await expect(noKey.service.resolve('acmeship', 'stg')).rejects.toBeInstanceOf(
      NemoCredentialMissingError,
    );

    const { ciphertext, keyId } = encryptSecret(KEYS, CREDENTIAL_JSON);
    const noBusinessId = harness({
      vault: `v1:${KEY_V1}`,
      rows: {
        'LEFT JOIN platform.nemo_credential': [{ ciphertext, key_id: keyId }],
      },
    });
    await expect(noBusinessId.service.resolve('acmeship', 'stg')).resolves.toMatchObject({
      businessId: 'nemolink-acmeship',
    });
  });

  it('treats an unknown org as a missing credential, not a crash', async () => {
    const { service } = harness({ rows: { 'LEFT JOIN platform.nemo_credential': [] } });
    await expect(service.resolve('nobody', 'stg')).rejects.toBeInstanceOf(
      NemoCredentialMissingError,
    );
  });

  it('reads neither organization.business_id nor the carrier-agent id — the shared staging key belongs to another organisation and identifies itself', async () => {
    const { service, query } = harness({
      rows: { 'LEFT JOIN platform.nemo_credential': [] },
    });
    await service.resolve('acmeship', 'stg').catch(() => undefined);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('business_id');
    expect(sql).not.toContain('ram:CarrierAgentTradeParty');
  });

  it('scopes the lookup to the requested target', async () => {
    const { service, query } = harness({
      rows: { 'LEFT JOIN platform.nemo_credential': [] },
    });
    await service.resolve('acmeship', 'prd').catch(() => undefined);
    expect(query.mock.calls[0]?.[1]).toEqual(['acmeship', 'prd']);
  });
});

describe('status — never the secret (AC 4)', () => {
  it('reports both targets, configured or not, with no ciphertext read', async () => {
    const { service, query } = harness({
      rows: {
        'SELECT c.nemo_target': [
          {
            nemo_target: 'stg',
            label: 'pilot key',
            key_id: 'v1',
            author: ADMIN.username,
            updated: new Date('2026-09-09T08:00:00Z'),
          },
        ],
      },
    });
    const status = await service.status('acmeship');
    expect(status).toEqual([
      {
        target: 'stg',
        configured: true,
        label: 'pilot key',
        keyId: 'v1',
        author: ADMIN.username,
        updated: '2026-09-09T08:00:00.000Z',
      },
      { target: 'prd', configured: false, label: null, keyId: null, author: null, updated: null },
    ]);
    expect(query.mock.calls[0]?.[0]).not.toContain('ciphertext');
    expect(JSON.stringify(status)).not.toContain('s3cr3t');
  });
});

describe('set — rotation is deactivate + insert (AC 3)', () => {
  const input = {
    target: 'stg' as const,
    clientId: 'nemolink-acmeship',
    clientSecret: 's3cr3t',
    label: 'pilot key',
  };

  it('deactivates the prior active row for that target, then inserts', async () => {
    const { service, queries } = harness({
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
      replacedRowCount: 1,
    });
    await service.set(ADMIN, input);

    const update = queries.find((q) => q.sql.startsWith('UPDATE platform.nemo_credential'));
    const insert = queries.find((q) => q.sql.includes('INSERT INTO platform.nemo_credential'));
    expect(update?.params).toEqual(['org-1', 'stg']);
    expect(update?.sql).toContain('is_active = false');
    // Never an UPDATE of the ciphertext in place — the old row stays readable
    expect(update?.sql).not.toContain('ciphertext');
    expect(insert).toBeDefined();
    expect(queries.indexOf(update!)).toBeLessThan(queries.indexOf(insert!));
  });

  it('stores ciphertext and the active key id, never the plaintext', async () => {
    const { service, queries } = harness({
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
    });
    await service.set(ADMIN, input);
    const insert = queries.find((q) => q.sql.includes('INSERT INTO platform.nemo_credential'))!;
    const [, target, label, ciphertext, keyId, author] = insert.params as [
      string, string, string, Buffer, string, string,
    ];
    expect(target).toBe('stg');
    expect(label).toBe('pilot key');
    expect(keyId).toBe('v1');
    expect(author).toBe(ADMIN.username);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(ciphertext.toString('utf8')).not.toContain('s3cr3t');
    // …and it really is the credential, not something lossy
    expect(
      JSON.parse(decryptSecret(parseVaultKeys(`v1:${KEY_V1}`), ciphertext, keyId)),
    ).toEqual({ clientId: 'nemolink-acmeship', clientSecret: 's3cr3t' });
  });

  it('audits set vs rotate, carrying neither the client id nor the secret (AC 4)', async () => {
    const fresh = harness({
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
      replacedRowCount: 0,
    });
    await fresh.service.set(ADMIN, input);
    expect(fresh.audits[0]).toMatchObject({
      actorId: ADMIN.username,
      entityType: 'nemo_credential',
      entityId: 'org-1',
      schema: 'org_acmeship',
      data: { action: 'credential_set', target: 'stg', label: 'pilot key', keyId: 'v1' },
    });

    const rotated = harness({
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
      replacedRowCount: 1,
    });
    await rotated.service.set(ADMIN, input);
    expect((rotated.audits[0]!.data as Record<string, unknown>).action).toBe(
      'credential_rotated',
    );

    for (const events of [fresh.audits, rotated.audits]) {
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain('s3cr3t');
      expect(serialized).not.toContain('nemolink-acmeship');
    }
  });

  it('refuses to encrypt at all when the vault is unconfigured', async () => {
    const { service, queries } = harness({
      vault: undefined,
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
    });
    await expect(service.set(ADMIN, input)).rejects.toBeInstanceOf(VaultNotConfiguredError);
    // Nothing was written on the way to failing
    expect(queries).toEqual([]);
  });
});

describe('remove', () => {
  it('deactivates and audits when there was something to remove', async () => {
    const { service, audits, queries } = harness({
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
      replacedRowCount: 1,
    });
    await service.remove(ADMIN, 'prd');
    expect(queries.some((q) => q.sql.startsWith('UPDATE platform.nemo_credential'))).toBe(
      true,
    );
    expect(audits[0]).toMatchObject({
      entityType: 'nemo_credential',
      data: { action: 'credential_removed', target: 'prd' },
    });
  });

  it('is a no-op — and writes no audit noise — when nothing was active', async () => {
    const { service, audits } = harness({
      rows: { 'SELECT id FROM platform.organization': [{ id: 'org-1' }] },
      replacedRowCount: 0,
    });
    await service.remove(ADMIN, 'prd');
    expect(audits).toEqual([]);
  });
});
