/**
 * The NOA's call facts, resolved once (spec 0090): what was entered in
 * NEMOLink, what each external source says, and what goes to NEMO —
 * entered, else the first source. The checklist, the payload and the
 * wizard's ledger all read this, so they cannot disagree.
 *
 * Sources, in the order they are preferred when nothing is entered:
 * - purpose of call: the source system's push (opsDesk's call type, mapped in
 *   its integration);
 * - last port: the call's rotation (the source system, or the call form),
 *   then the NSW security form's port facility calls;
 * - crew, persons on board, master: the crew list (and passenger list), a
 *   FAL 1 or health declaration count;
 * - type of voyage: international when the last port is foreign; after a
 *   Finnish port only the user says.
 */

import type { FormFacts } from './form-facts';
import type { ObligationSnapshot } from './obligations';

export interface FactSource {
  value: unknown;
  /** Words: "opsdesk", "NSW crew list (file.xlsx)", "port call rotation", … */
  source: string;
  at: string | null;
}

export interface CallFact {
  /** Entered in NEMOLink (the wizard), or null. */
  entered: unknown;
  /** What each external source says, preferred first. */
  externals: FactSource[];
  /** What goes to NEMO: entered, else the first source. */
  toNemo: unknown;
}

export const NOA_CALL_FACTS = [
  'purposeOfCall',
  'maxDraught',
  'crew',
  'personsOnBoard',
  'masterFamilyName',
  'masterGivenNames',
  'lastPort',
  'voyageType',
] as const;
export type NoaCallFactKey = (typeof NOA_CALL_FACTS)[number];

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

function fact(entered: unknown, externals: FactSource[]): CallFact {
  const found = externals.filter((e) => present(e.value));
  return {
    entered: present(entered) ? entered : null,
    externals: found,
    toNemo: present(entered) ? entered : (found[0]?.value ?? null),
  };
}

function fromForm<T>(f: FormFacts[keyof FormFacts] | undefined): FactSource[] {
  return f ? [{ value: f.value as T, source: f.source, at: f.at }] : [];
}

/** Every NOA call fact for this snapshot. */
export function noaCallFacts(snap: ObligationSnapshot): Record<NoaCallFactKey, CallFact> {
  const n = snap.notice ?? {};
  const forms = snap.formFacts ?? {};
  const purposes = snap.callPurposes;
  const lastPort = fact(n.lastPort, [
    ...(snap.prevPorts?.[0] ? [{ value: snap.prevPorts[0], source: 'port call rotation', at: null }] : []),
    ...fromForm(forms.lastPort),
  ]);
  const last = typeof lastPort.toNemo === 'string' ? lastPort.toNemo : null;
  return {
    purposeOfCall: fact(
      n.purposeOfCall ? [n.purposeOfCall] : null,
      purposes ? [{ value: purposes.value, source: purposes.source, at: purposes.receivedAt }] : [],
    ),
    maxDraught: fact(n.maxDraught, []),
    crew: fact(n.crew, fromForm(forms.crew)),
    personsOnBoard: fact(n.personsOnBoard, fromForm(forms.personsOnBoard)),
    masterFamilyName: fact(n.masterFamilyName, fromForm(forms.masterFamilyName)),
    masterGivenNames: fact(n.masterGivenNames, fromForm(forms.masterGivenNames)),
    lastPort,
    voyageType: fact(
      n.voyageType,
      last && !last.startsWith('FI') ? [{ value: 'V-01', source: 'the last port is foreign', at: null }] : [],
    ),
  };
}
