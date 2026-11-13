/**
 * What goes to NEMO with the NOA (spec 0098): the catalogue of pre-arrival
 * reports, which of them are ticked for this call and why, and where each
 * one's data stands. The user's choice wins and is kept on the call
 * (`data.nemo.reports`); otherwise the tier's default, or the call's
 * evidence for a report that applies only sometimes. Pure: no IO.
 */

import { createHash } from 'node:crypto';
import {
  buildCwaPayload,
  buildEffPayload,
  buildSecPayload,
  buildStaPayload,
  buildWasPayload,
  type Built,
  type TableLike,
} from './pre-arrival-formalities';

export type ReportTier = 'usually' | 'compulsory' | 'ifApplies';

export interface ReportDef {
  code: string;
  title: string;
  tier: ReportTier;
  /** NEMOLink builds it; the others are sent in NEMO for now. */
  built: boolean;
}

/** In the order the wizard lists and the send sends them, after the NOA and the DUE. */
export const PRE_ARRIVAL_REPORTS: ReportDef[] = [
  { code: 'CWA', title: 'Crew list', tier: 'usually', built: true },
  { code: 'EFF', title: 'Crew effects', tier: 'usually', built: true },
  { code: 'STA', title: 'Ship’s stores', tier: 'usually', built: true },
  { code: 'WAS', title: 'Waste', tier: 'compulsory', built: true },
  { code: 'SEC', title: 'Security', tier: 'compulsory', built: true },
  { code: 'PXA', title: 'Passengers', tier: 'ifApplies', built: false },
  { code: 'CGA', title: 'Cargo', tier: 'ifApplies', built: false },
  { code: 'HZA', title: 'Dangerous goods', tier: 'ifApplies', built: false },
  { code: 'MDH', title: 'Health declaration', tier: 'ifApplies', built: false },
];

export const TIER_WORDS: Record<ReportTier, string> = {
  usually: 'Usually sent',
  compulsory: 'Compulsory for most ships',
  ifApplies: 'If it applies',
};

/** The user's tick, kept per call (data.nemo.reports.<CODE>). */
export interface StoredChoice {
  on: boolean;
  by: string;
  at: string;
}

/** A report NEMO has from this call (data.nemo.formalities.<CODE>), as far as the choice reads it. */
export interface SentLike {
  accepted: boolean;
  sentAt: string;
  version: number;
  fingerprint?: string;
}

export interface ReportChoice {
  code: string;
  title: string;
  tier: ReportTier;
  built: boolean;
  /** Goes with the next send. */
  on: boolean;
  /** Who decided: the tier's default, the call's evidence, or the user. */
  decidedBy: 'default' | 'evidence' | 'user';
  /** Why it is on or off, in words ("12 passengers in the uploaded list"). */
  why: string | null;
  /** Where its data stands, in words: rows and the forms, or what to upload. */
  data: string;
  missing: string[];
  /** In NEMO already: accepted from this call. */
  inNemo: boolean;
  /** NEMO refused the latest send (2026-10-06): the chip shows it until a send is accepted. */
  refused: boolean;
  /** In NEMO and nothing changed since: the send leaves it be. */
  current: boolean;
}

/** The call's NEMO tables by key (spec 0096), with the forms that fed them. */
export type TablesByKey = Partial<Record<'crew' | 'passengers' | 'stores' | 'waste' | 'security' | 'health', TableLike & { sources?: { fileName: string }[] }>>;

export interface PreArrivalInput {
  tables: TablesByKey;
  stored: Record<string, StoredChoice>;
  sent: Record<string, SentLike>;
  /** The GISIS code of the NOA's port area (SEC). */
  facility: string | null;
  cargo: { count: number; description: string | null };
}

/** The built data section of every buildable report, whether ticked or not. */
export function buildReport(code: string, input: PreArrivalInput): Built {
  const t = input.tables;
  switch (code) {
    case 'CWA':
      return buildCwaPayload(t.crew ?? null);
    case 'EFF':
      return buildEffPayload(t.crew ?? null);
    case 'STA':
      return buildStaPayload(t.stores ?? null);
    case 'WAS':
      return buildWasPayload(t.waste ?? null);
    case 'SEC':
      return buildSecPayload(t.security ?? null, input.facility);
    default:
      return { missing: ['not in NEMOLink yet — send it in NEMO'] };
  }
}

/** A report's data, fingerprinted: an accepted send with the same print is current. */
export function fingerprintOf(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function fromForms(table: { sources?: { fileName: string }[] } | undefined): string {
  const names = [...new Set((table?.sources ?? []).map((s) => s.fileName))];
  return names.length > 0 ? ` · from ${names.join(', ')}` : '';
}

/** The call's evidence that a sometimes-report applies; null when none. */
function evidenceOf(code: string, input: PreArrivalInput): string | null {
  const t = input.tables;
  switch (code) {
    case 'PXA': {
      const n = t.passengers?.rows.length ?? 0;
      return n > 0 ? `${plural(n, 'passenger', 'passengers')} in the uploaded list` : null;
    }
    case 'MDH':
      return (t.health?.sources?.length ?? 0) > 0 ? 'a health declaration was uploaded' : null;
    case 'CGA':
      if (input.cargo.count > 0) return `the call carries ${plural(input.cargo.count, 'cargo', 'cargoes')}`;
      return input.cargo.description ? `the call carries cargo (${input.cargo.description})` : null;
    default:
      return null;
  }
}

/** Where the data stands, in words, from the built result. */
function dataWords(code: string, built: Built, input: PreArrivalInput): string {
  if (!('payload' in built)) return `Missing: ${built.missing.join('; ')}`;
  const t = input.tables;
  switch (code) {
    case 'CWA':
      return `${plural(t.crew?.rows.length ?? 0, 'crew member', 'crew members')}${fromForms(t.crew)}`;
    case 'EFF': {
      const n = (t.crew?.rows ?? []).filter((r) => (r.items ?? []).length > 0).length;
      return `${plural(n, 'crew member', 'crew members')} with effects${fromForms(t.crew)}`;
    }
    case 'STA':
      return `${plural(t.stores?.rows.length ?? 0, 'article', 'articles')}${fromForms(t.stores)}`;
    case 'WAS': {
      const m = built.payload['was:SpecifiedLogisticsTransportMovement'] as Record<string, any>;
      const n = (m['ram:ReportedTransportationWasteMaterial']['ram:IncludedTransportationWasteMaterialComponent'] as unknown[]).length;
      return `${plural(n, 'waste type', 'waste types')}${fromForms(t.waste)}`;
    }
    case 'SEC':
      return `${plural(t.security?.rows.length ?? 0, 'previous call', 'previous calls')}, facility ${input.facility}${fromForms(t.security)}`;
    default:
      return '';
  }
}

export function preArrivalChoices(input: PreArrivalInput): { choices: ReportChoice[]; built: Record<string, Built> } {
  const built: Record<string, Built> = {};
  const choices = PRE_ARRIVAL_REPORTS.map((def): ReportChoice => {
    const b = def.built ? buildReport(def.code, input) : null;
    if (b) built[def.code] = b;
    const sent = input.sent[def.code];
    const inNemo = !!sent?.accepted || (sent?.version ?? 0) > 0;
    const refused = !!sent && !sent.accepted;
    const current = inNemo && !!b && 'payload' in b && sent?.fingerprint === fingerprintOf(b.payload);
    const evidence = evidenceOf(def.code, input);
    const stored = input.stored[def.code];
    const data = !def.built
      ? 'Not in NEMOLink yet — send it in NEMO'
      : dataWords(def.code, b!, input);
    const missing = b && !('payload' in b) ? b.missing : [];
    const base = { code: def.code, title: def.title, tier: def.tier, built: def.built, data, missing, inNemo, refused, current: current && !refused };

    // Not built: never ticked here; the evidence still says it applies
    if (!def.built) {
      return { ...base, on: false, decidedBy: evidence ? 'evidence' : 'default', why: evidence ? `Applies: ${evidence}` : null };
    }
    // A report NEMO has stays ticked: its update follows the data (unticking is no withdrawal)
    if (inNemo) return { ...base, on: true, decidedBy: 'default', why: 'In NEMO — an update goes when its data changes' };
    if (stored) {
      return { ...base, on: stored.on, decidedBy: 'user', why: stored.on ? 'Ticked by you' : 'Left out by you' };
    }
    if (def.tier !== 'ifApplies') return { ...base, on: true, decidedBy: 'default', why: TIER_WORDS[def.tier] };
    return evidence
      ? { ...base, on: true, decidedBy: 'evidence', why: `On: ${evidence}` }
      : { ...base, on: false, decidedBy: 'default', why: null };
  });
  return { choices, built };
}
