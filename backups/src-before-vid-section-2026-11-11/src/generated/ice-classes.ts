/**
 * GENERATED FILE — do not edit. Source of truth:
 * vendor/nemo/mig/2.0.1.0/SHP_2.0.1.0.json (qdt:ICEClassCodeContentType)
 * vendor/national-spreadsheet/codelists/ice_class.json (names)
 * Regenerate: node tools/gen-ship-refs.js  (docs/specs/0036)
 */

export interface IceClass {
  code: string;
  name: string;
}

export const ICE_CLASSES: IceClass[] = [
  { code: "FS1A", name: "IA" },
  { code: "FS1B", name: "IB" },
  { code: "FS1C", name: "IC" },
  { code: "FS1S", name: "IA Super" },
  { code: "FSII", name: "II" },
  { code: "FSIII", name: "III" },
  { code: "UKN", name: "Unknown" },
];

const BY_CODE = new Map(ICE_CLASSES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function iceClassName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
