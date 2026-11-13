/**
 * Vault encryption for customer NEMO credentials (docs/specs/0059).
 *
 * AES-256-GCM under a master key held outside the database, so a database-only
 * compromise — a leaked dump, a restored backup, the pgBackRest bucket — yields
 * nothing. Node's own crypto; no new dependency (invariant 7).
 *
 * NEMO_VAULT_KEYS=v1:<64 hex>[,v0:<64 hex>] — the FIRST entry encrypts, every
 * entry can decrypt. That is what makes master-key rotation a deploy plus a
 * re-encrypt pass instead of an outage, and what the nemo_credential.key_id
 * column has always been for.
 *
 * Blob layout: version(1) | iv(12) | tag(16) | ciphertext.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FORMAT_VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The vault key is not configured — a deployment gap, not a user error. */
export class VaultNotConfiguredError extends Error {
  constructor() {
    super(
      'NEMO credential vault is not configured: set NEMO_VAULT_KEYS ' +
        '(docs/specs/0059) before storing or reading customer NEMO keys',
    );
    this.name = 'VaultNotConfiguredError';
  }
}

/** A stored row names a master key this deployment does not have. */
export class VaultKeyMissingError extends Error {
  constructor(readonly keyId: string) {
    super(
      `NEMO credential was encrypted under vault key '${keyId}', which is not in ` +
        'NEMO_VAULT_KEYS — the key was removed or the row came from another deployment',
    );
    this.name = 'VaultKeyMissingError';
  }
}

/** Ciphertext did not authenticate: wrong key, or the bytes were altered. */
export class VaultDecryptError extends Error {
  constructor(keyId: string) {
    super(`NEMO credential failed to decrypt under vault key '${keyId}'`);
    this.name = 'VaultDecryptError';
  }
}

export interface VaultKey {
  keyId: string;
  key: Buffer;
}

/**
 * Parses NEMO_VAULT_KEYS. Order is meaningful — [0] encrypts. Throws on a
 * malformed value rather than silently dropping an entry: half a key list is
 * how rows become undecryptable.
 */
export function parseVaultKeys(raw: string | undefined): VaultKey[] {
  if (!raw || !raw.trim()) return [];
  const keys: VaultKey[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const at = entry.indexOf(':');
    if (at < 0) {
      throw new Error('NEMO_VAULT_KEYS entries must be "<keyId>:<64 hex chars>"');
    }
    const keyId = entry.slice(0, at).trim();
    const hex = entry.slice(at + 1).trim();
    if (!KEY_ID_RE.test(keyId)) {
      throw new Error(
        `NEMO_VAULT_KEYS key id '${keyId}' must be lowercase alphanumeric, - or _`,
      );
    }
    if (seen.has(keyId)) {
      throw new Error(`NEMO_VAULT_KEYS lists key id '${keyId}' twice`);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        `NEMO_VAULT_KEYS key '${keyId}' must be exactly 64 hex characters (32 bytes)`,
      );
    }
    seen.add(keyId);
    keys.push({ keyId, key: Buffer.from(hex, 'hex') });
  }
  return keys;
}

/** Encrypts under keys[0]; returns the blob and the key id that made it. */
export function encryptSecret(
  keys: VaultKey[],
  plaintext: string,
): { ciphertext: Buffer; keyId: string } {
  const active = keys[0];
  if (!active) throw new VaultNotConfiguredError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', active.key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([
      Buffer.from([FORMAT_VERSION]),
      iv,
      cipher.getAuthTag(),
      body,
    ]),
    keyId: active.keyId,
  };
}

/** Decrypts a blob written under keyId. Any tampering fails the GCM tag. */
export function decryptSecret(keys: VaultKey[], blob: Buffer, keyId: string): string {
  if (keys.length === 0) throw new VaultNotConfiguredError();
  const entry = keys.find((k) => k.keyId === keyId);
  if (!entry) throw new VaultKeyMissingError(keyId);
  if (blob.length < 1 + IV_BYTES + TAG_BYTES || blob[0] !== FORMAT_VERSION) {
    throw new VaultDecryptError(keyId);
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = blob.subarray(1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', entry.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // Never surface the underlying message — it varies by failure mode
    throw new VaultDecryptError(keyId);
  }
}

@Injectable()
export class CredentialCrypto {
  private cached: VaultKey[] | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Parsed once per process; a bad value throws on first use, loudly. */
  private get keys(): VaultKey[] {
    this.cached ??= parseVaultKeys(this.config.get<string>('NEMO_VAULT_KEYS'));
    return this.cached;
  }

  get configured(): boolean {
    return this.keys.length > 0;
  }

  encrypt(plaintext: string): { ciphertext: Buffer; keyId: string } {
    return encryptSecret(this.keys, plaintext);
  }

  decrypt(blob: Buffer, keyId: string): string {
    return decryptSecret(this.keys, blob, keyId);
  }
}
