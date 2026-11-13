/**
 * Schema watch (docs/specs/0024): detects upstream drift of the vendored NEMO
 * contracts. Baseline = each manifest entry's sourceSha256 (hash of the raw
 * upstream bytes, recorded at vendoring time); the watch re-fetches every
 * source URL and compares raw hashes — no parser/formatter duplication with
 * tools/nemo-schemas. The vendored MIG index makes NEW/removed schema files
 * detectable, not just edits. Watch-only: adopting a change stays a human
 * step (re-vendor → review → gates → deploy).
 *
 * These are public GitHub-Pages fetches (no credentials) — the same source
 * the vendoring tool reads; invariant 4 concerns NEMO API traffic.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ManifestEntry {
  file: string;
  source: string;
  sha256: string;
  sourceSha256?: string;
}

export interface SchemaWatchResult {
  checked: number;
  changed: string[];
  newUpstream: string[];
  removedUpstream: string[];
  missingBaseline: string[];
  [key: string]: unknown;
}

export type Fetcher = (url: string) => Promise<string>;

const MIG_INDEX_FILE = 'mig/index.json';

export function loadManifest(vendorDir: string): ManifestEntry[] {
  const doc = JSON.parse(
    readFileSync(join(vendorDir, 'nemo', 'manifest.json'), 'utf8'),
  ) as { files?: ManifestEntry[] };
  if (!Array.isArray(doc.files) || doc.files.length === 0) {
    throw new Error('vendor manifest has no files');
  }
  return doc.files;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Pure: raw upstream hashes vs recorded baselines. */
export function compareSources(
  entries: ManifestEntry[],
  fetchedHashes: Map<string, string>,
): { changed: string[]; missingBaseline: string[] } {
  const changed: string[] = [];
  const missingBaseline: string[] = [];
  for (const entry of entries) {
    if (!entry.sourceSha256) {
      missingBaseline.push(entry.file);
      continue;
    }
    const got = fetchedHashes.get(entry.file);
    if (got && got !== entry.sourceSha256) changed.push(entry.file);
  }
  return { changed, missingBaseline };
}

/** Pure: upstream MIG index listing vs the manifest's vendored schema files. */
export function diffMigIndex(
  upstreamIndex: { schemas?: { file?: string }[] },
  entries: ManifestEntry[],
): { newUpstream: string[]; removedUpstream: string[] } {
  const upstream = new Set(
    (upstreamIndex.schemas ?? [])
      .map((s) => (typeof s.file === 'string' ? s.file.slice(s.file.lastIndexOf('/') + 1) : ''))
      .filter(Boolean),
  );
  const vendored = new Set(
    entries
      .filter((e) => e.file.startsWith('mig/') && e.file !== MIG_INDEX_FILE)
      .map((e) => e.file.slice(e.file.lastIndexOf('/') + 1)),
  );
  return {
    newUpstream: [...upstream].filter((f) => !vendored.has(f)).sort(),
    removedUpstream: [...vendored].filter((f) => !upstream.has(f)).sort(),
  };
}

/**
 * Retrying GET for public hub content (also used by the locations sync,
 * docs/specs/0027): 3 attempts on network errors / 5xx, fail fast on 4xx.
 */
export async function fetchTextWithRetry(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (error) {
      if (attempt >= 3) throw error;
    }
    if (res?.ok) return res.text();
    if (res && res.status < 500) throw new Error(`GET ${url} -> ${res.status}`);
    if (attempt >= 3) throw new Error(`GET ${url} -> ${res ? res.status : 'network error'}`);
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
}

export async function watchSchemas(
  vendorDir: string,
  fetcher: Fetcher = fetchTextWithRetry,
): Promise<SchemaWatchResult> {
  const entries = loadManifest(vendorDir);

  // Fetch all sources with a small concurrency pool — ~41 public files.
  const hashes = new Map<string, string>();
  const raws = new Map<string, string>();
  let next = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (next < entries.length) {
      const entry = entries[next++]!;
      const raw = await fetcher(entry.source);
      hashes.set(entry.file, sha256(raw));
      raws.set(entry.file, raw);
    }
  });
  await Promise.all(workers);

  const { changed, missingBaseline } = compareSources(entries, hashes);

  let newUpstream: string[] = [];
  let removedUpstream: string[] = [];
  const indexRaw = raws.get(MIG_INDEX_FILE);
  if (indexRaw) {
    ({ newUpstream, removedUpstream } = diffMigIndex(
      JSON.parse(indexRaw) as { schemas?: { file?: string }[] },
      entries,
    ));
  }

  return {
    checked: entries.length,
    changed: changed.sort(),
    newUpstream,
    removedUpstream,
    missingBaseline: missingBaseline.sort(),
  };
}
