/**
 * PEC reference data (docs/specs/0045). The Finnish VTS areas have no
 * vendored codelist (open question 7d) — this list is the user decision
 * 2026-08-24 and mirrors server/src/auth/pec.ts.
 */

export const PEC_REGIONS: { value: string; label: string }[] = [
  { value: 'archipelago', label: 'Archipelago VTS' },
  { value: 'bothnia', label: 'Bothnia VTS' },
  { value: 'hanko', label: 'Hanko VTS' },
  { value: 'helsinki', label: 'Helsinki VTS' },
  { value: 'kotka', label: 'Kotka VTS' },
  { value: 'saimaa', label: 'Saimaa VTS' },
  { value: 'west-coast', label: 'West Coast VTS' },
];

const BY_ID = new Map(PEC_REGIONS.map((r) => [r.value, r.label]));

export function pecRegionName(id: string): string {
  return BY_ID.get(id) ?? id;
}

export const PEC_TYPES = [
  { value: 'restricted', label: 'Restricted' },
  { value: 'unrestricted', label: 'Unrestricted' },
];
