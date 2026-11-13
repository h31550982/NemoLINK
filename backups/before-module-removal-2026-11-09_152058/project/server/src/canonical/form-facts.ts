/**
 * The facts the master's pre-arrival forms give the notices (spec 0090 §1):
 * a source lane for the call, like the ship lanes. Derived from the call's
 * ACTIVE parsed uploads (last in wins per form, spec 0050) with the
 * operator's corrections applied, and kept on the call as
 * `port_call.data.formFacts` so the checklists and the send read the same
 * values without re-reading PII.
 *
 * - Crew: the NSW crew list's rows (arrival or both), else the count a
 *   FAL 1 or the health declaration states.
 * - Master: the crew list row ranked Master; else FAL 1's "name of master"
 *   is shown but not split (a full name is not a family and given name).
 * - Persons on board: crew + the passenger list's rows; crew alone when no
 *   passenger list or count says otherwise.
 * - Last port: the NSW security form's most recent port facility call that
 *   ended before this call's ETA. The waste form's last port of delivery is
 *   NOT used: a ship does not deliver waste in every port (user, 2026-09-27).
 */

import type { PoolClient } from 'pg';
import { applyCorrections, type Corrections } from '../ingest/documents/form-checks';
import { FORM_NAMES, type FormType, type ParsedForm } from '../ingest/documents/form-parser';

export interface FormFact<T> {
  value: T;
  /** Words: the form and its file, e.g. "NSW crew list (Corvus crew.xlsx)". */
  source: string;
  /** When the form was uploaded. */
  at: string;
}

export interface FormFacts {
  crew?: FormFact<number>;
  personsOnBoard?: FormFact<number>;
  masterFamilyName?: FormFact<string>;
  masterGivenNames?: FormFact<string>;
  lastPort?: FormFact<string>;
}

export interface ActiveForm {
  form: ParsedForm;
  fileName: string;
  uploadedAt: string;
}

const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;

function count(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(String(text).replace(/[^\d]/g, ''));
  return Number.isInteger(n) && String(text).trim() !== '' ? n : null;
}

function sourceOf(f: ActiveForm): { source: string; at: string } {
  return { source: `${FORM_NAMES[f.form.formType as FormType] ?? f.form.formType} (${f.fileName})`, at: f.uploadedAt };
}

/** The facts from the active forms; `eta` decides which past call is the last port. */
export function formFactsOf(forms: ActiveForm[], eta: string | null): FormFacts {
  const out: FormFacts = {};
  const byType = (type: FormType) =>
    forms
      .filter((f) => f.form.formType === type && f.form.context !== 'departure')
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];

  const crewList = byType('nsw-crew');
  if (crewList && Array.isArray(crewList.form.rows) && crewList.form.rows.length > 0) {
    const rows = crewList.form.rows;
    out.crew = { value: rows.length, ...sourceOf(crewList) };
    const master = rows.find((r) => /^master$|^captain$/i.test(String(r['rank'] ?? '').trim()));
    if (master) {
      const family = String(master['lastName'] ?? '').trim();
      const given = String(master['firstName'] ?? '').trim();
      if (family) out.masterFamilyName = { value: family, ...sourceOf(crewList) };
      if (given) out.masterGivenNames = { value: given, ...sourceOf(crewList) };
    }
  }
  // A stated count where no crew list has rows: FAL 1, then the health declaration
  for (const type of ['fal1', 'nmsw-mdh'] as FormType[]) {
    if (out.crew) break;
    const f = byType(type);
    const n = count(f?.form.fields['crewCount']);
    if (f && n !== null) out.crew = { value: n, ...sourceOf(f) };
  }

  if (out.crew) {
    const paxList = byType('nsw-pax');
    let passengers = 0;
    let paxSource: ActiveForm | undefined;
    if (paxList && Array.isArray(paxList.form.rows)) {
      passengers = paxList.form.rows.length;
      paxSource = paxList;
    } else {
      for (const type of ['fal1', 'nmsw-mdh'] as FormType[]) {
        const f = byType(type);
        const n = count(f?.form.fields['passengerCount']);
        if (f && n !== null) {
          passengers = n;
          paxSource = f;
          break;
        }
      }
    }
    const from = paxSource ? `${out.crew.source} + ${sourceOf(paxSource).source}` : out.crew.source;
    out.personsOnBoard = { value: out.crew.value + passengers, source: from, at: out.crew.at };
  }

  const security = byType('nsw-security');
  if (security && Array.isArray(security.form.rows)) {
    const cutoff = eta ? eta.slice(0, 10) : null;
    const last = security.form.rows.find((r) => {
      const port = String(r['portLocode'] ?? '').trim().toUpperCase();
      if (!LOCODE.test(port)) return false;
      const left = String(r['departure'] ?? r['arrival'] ?? '').trim();
      return !cutoff || !left || left <= cutoff;
    });
    if (last) out.lastPort = { value: String(last['portLocode']).trim().toUpperCase(), ...sourceOf(security) };
  }
  return out;
}

/**
 * Re-derives the call's form facts from its active uploads and stores them
 * (`port_call.data.formFacts`). Called after an upload, a correction or a
 * removal, and before a notice is prepared — which also fills calls whose
 * forms came before this existed.
 */
export async function refreshFormFacts(client: PoolClient, portCallId: string): Promise<FormFacts> {
  const docs = await client.query<{
    parsed: { form?: ParsedForm | null } | null;
    corrections: Corrections | null;
    file_name: string;
    created: Date;
  }>(
    `SELECT parsed, corrections, file_name, created FROM port_call_document
      WHERE port_call_id = $1 AND is_active AND parsed IS NOT NULL
        AND NOT ship_confirm_needed`,
    [portCallId],
  );
  const forms: ActiveForm[] = (docs.rows ?? [])
    .filter((d) => d.parsed?.form)
    .map((d) => ({
      form: applyCorrections(d.parsed!.form!, d.corrections),
      fileName: d.file_name,
      uploadedAt: d.created.toISOString(),
    }));
  const call = await client.query<{ eta: Date | null }>(`SELECT eta FROM port_call WHERE id = $1`, [portCallId]);
  const facts = formFactsOf(forms, call.rows?.[0]?.eta instanceof Date ? call.rows[0].eta.toISOString() : null);
  await client.query(
    `UPDATE port_call SET data = data || jsonb_build_object('formFacts', $2::jsonb) WHERE id = $1`,
    [portCallId, JSON.stringify(facts)],
  );
  return facts;
}
