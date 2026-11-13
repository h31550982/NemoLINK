/**
 * The NOA as ledger rows (spec 0090): one row per element with the
 * five-column model of the ship dialog (spec 0086) — External (every
 * source that has a value, with where and when), NEMOLink (what was
 * entered here: the call fact, the org's ship override, the org setting),
 * To NEMO, and the NEMO code. The row's owner says where an edit saves.
 *
 * A row the wizard shows even with All details off: missing (`ok` false),
 * or its sources disagree (`differs`).
 */

import { DUES_LANGUAGE, NEXT_PORT_UNKNOWN, type ObligationSnapshot } from './obligations';
import { noaCallFacts, type FactSource, type NoaCallFactKey } from './noa-facts';

export type LedgerOwner = 'call' | 'ship' | 'org' | 'callCore' | 'fixed';
export type LedgerKind = 'text' | 'number' | 'time' | 'code';
export type LedgerCodelist = 'purpose' | 'voyage' | 'country' | 'registry' | 'shipType' | 'language' | 'locode' | 'portArea' | 'berth';

export interface LedgerRow {
  /** owner:field, e.g. call:crew, ship:flagState, org:agentId — what the save route takes. */
  key: string;
  label: string;
  /** EMSWe data element id; null for a NEMO UI field without one. */
  de: string | null;
  kind: LedgerKind;
  codelist?: LedgerCodelist;
  /** A value may be a list (the purposes of call). */
  multiple?: boolean;
  owner: LedgerOwner;
  /**
   * Edited in place in the wizard. callCore is the call's own record: the
   * port area and berth are picked here from the port's list; the rest is
   * edited on the port call. Fixed never.
   */
  editable: boolean;
  externals: FactSource[];
  entered: unknown;
  toNemo: unknown;
  ok: boolean;
  /** Two sources say different things. */
  differs: boolean;
}

export interface ShipCells {
  /** The External column per field key (ShipRow.external). */
  external: Record<string, { value: unknown; source: string; receivedAt: string } | undefined>;
  /** The org's overrides per field key (ShipRow.overrides). */
  overrides: Record<string, { value: unknown; superseded?: boolean } | undefined>;
  /** To NEMO particulars (ShipRow.particulars). */
  particulars: Record<string, unknown>;
}

export interface OrgCells {
  agentId: string | null;
  agencyName: string | null;
  mobile: string | null;
  email: string | null;
  /** The DUE's liable party (spec 0092): business id and postal address. */
  businessId: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  countryCode: string | null;
}

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function differsOf(externals: FactSource[]): boolean {
  return externals.some((e) => !same(e.value, externals[0]!.value));
}

export function noaLedger(snap: ObligationSnapshot, ship: ShipCells | null, org: OrgCells): LedgerRow[] {
  const facts = noaCallFacts(snap);
  const rows: LedgerRow[] = [];

  const callFact = (
    key: NoaCallFactKey,
    label: string,
    de: string,
    kind: LedgerKind,
    codelist?: LedgerCodelist,
    multiple?: boolean,
  ): LedgerRow => {
    const f = facts[key];
    return {
      key: `call:${key}`, label, de, kind, owner: 'call', editable: true,
      ...(codelist ? { codelist } : {}),
      ...(multiple ? { multiple } : {}),
      externals: f.externals, entered: f.entered, toNemo: f.toNemo,
      ok: present(f.toNemo), differs: differsOf(f.externals),
    };
  };
  const core = (key: string, label: string, de: string, value: unknown, kind: LedgerKind = 'text'): LedgerRow => ({
    key: `callCore:${key}`, label, de, kind, owner: 'callCore', editable: false,
    externals: present(value) ? [{ value, source: 'port call', at: null }] : [],
    entered: null, toNemo: present(value) ? value : null, ok: present(value), differs: false,
  });
  const shipRow = (key: string, label: string, de: string, codelist?: LedgerCodelist): LedgerRow => {
    const ext = ship?.external[key];
    const override = ship?.overrides[key];
    const entered = override && !override.superseded ? override.value : null;
    const toNemo = ship ? (ship.particulars[key] ?? null) : null;
    return {
      key: `ship:${key}`, label, de, kind: codelist ? 'code' : 'text', owner: 'ship', editable: !!ship,
      ...(codelist ? { codelist } : {}),
      externals: ext && present(ext.value) ? [{ value: ext.value, source: ext.source, at: ext.receivedAt }] : [],
      entered: present(entered) ? entered : null,
      toNemo: present(toNemo) ? toNemo : null,
      ok: present(toNemo), differs: false,
    };
  };
  const orgRow = (key: keyof OrgCells, label: string, de: string | null, codelist?: LedgerCodelist): LedgerRow => ({
    key: `org:${key}`, label, de, kind: codelist ? 'code' : 'text', owner: 'org', editable: true,
    ...(codelist ? { codelist } : {}),
    externals: [], entered: org[key], toNemo: org[key], ok: present(org[key]), differs: false,
  });

  rows.push({
    key: 'fixed:duesLanguage', label: 'Fairway dues decision language', de: null, kind: 'code', owner: 'fixed',
    editable: false, codelist: 'language', externals: [], entered: null, toNemo: DUES_LANGUAGE, ok: true, differs: false,
  });
  rows.push(core('eta', 'Estimated arrival', 'DE-022-02', snap.eta, 'time'));
  rows.push(core('etd', 'Estimated departure', 'DE-022-05', snap.etd, 'time'));
  rows.push(callFact('lastPort', 'Last port of call', 'DE-022-06', 'code', 'locode'));
  rows.push({
    key: 'fixed:nextPort', label: 'Next port of call', de: 'DE-022-08', kind: 'code', owner: 'fixed', editable: false,
    externals: [], entered: null, toNemo: NEXT_PORT_UNKNOWN, ok: true, differs: false,
  });
  // The place in the port (user 2026-09-30): picked here, from the port's own
  // areas and the berths of the area — kept side by side, area first
  rows.push({ ...core('portArea', 'Port area', 'DE-015-01', snap.portAreaCode), kind: 'code', codelist: 'portArea', editable: true });
  rows.push({ ...core('berth', 'Expected first location (berth)', 'DE-015-04', snap.berth), kind: 'code', codelist: 'berth', editable: true });
  rows.push(callFact('voyageType', 'Type of voyage', 'DE-014-22', 'code', 'voyage'));
  rows.push(callFact('purposeOfCall', 'Primary purpose of call', 'DE-014-10', 'code', 'purpose', true));
  rows.push(callFact('maxDraught', 'Actual maximum draught (m)', 'DE-017-03', 'number'));
  rows.push(shipRow('typeCode', 'Ship type', 'DE-005-16', 'shipType'));
  rows.push(shipRow('flagState', 'Flag state', 'DE-005-09', 'country'));
  rows.push(shipRow('registryCode', 'Ship registry', 'DE-005-10', 'registry'));
  rows.push(shipRow('registryPort', 'Port of registry', 'DE-005-12', 'locode'));
  rows.push(callFact('crew', 'Number of crew', 'DE-034-03', 'number'));
  rows.push(callFact('personsOnBoard', 'Persons on board', 'DE-034-01', 'number'));
  rows.push(callFact('masterFamilyName', "Master's family name", 'DE-012-01', 'text'));
  rows.push(callFact('masterGivenNames', "Master's given names", 'DE-012-08', 'text'));
  rows.push(orgRow('agentId', 'Agent identification (EORI)', 'DE-029-01'));
  rows.push(orgRow('agencyName', 'Agency name', 'DE-029-02'));
  rows.push(orgRow('mobile', 'Agent mobile', 'DE-029-07'));
  rows.push(orgRow('email', 'Agent email', 'DE-029-08'));
  // The DUE rides with the NOA (spec 0092): its liable party is the agency,
  // so only what the NOA rows above do not already hold
  rows.push(orgRow('businessId', 'Liable party business ID', 'DE-077-11'));
  rows.push(orgRow('street', 'Liable party street', 'DE-077-15'));
  rows.push(orgRow('postcode', 'Liable party postcode', 'DE-077-18'));
  rows.push(orgRow('city', 'Liable party city', 'DE-077-19'));
  rows.push(orgRow('countryCode', 'Liable party country', 'DE-077-20', 'country'));
  return rows;
}
