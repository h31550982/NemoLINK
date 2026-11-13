/**
 * GENERATED FILE — do not edit. Source of truth:
 * vendor/nemo/mig/2.0.1.0/SHP_2.0.1.0.json (qdt:TypeOfNavigationCodeContentType)
 * vendor/nemo/hub/codelists.json (type_of_navigation names)
 * Regenerate: node tools/gen-ship-refs.js  (docs/specs/0040)
 */

export interface NavigationType {
  code: string;
  name: string;
}

export const NAVIGATION_TYPES: NavigationType[] = [
  { code: "NAV-01", name: "International" },
  { code: "NAV-02", name: "Short international" },
  { code: "NAV-03", name: "International coastal" },
  { code: "NAV-04", name: "National" },
  { code: "NAV-05", name: "National coastal" },
  { code: "NAV-06", name: "Littoral navigation" },
  { code: "NAV-07", name: "Local navigation" },
  { code: "NAV-08", name: "Special" },
];

const BY_CODE = new Map(NAVIGATION_TYPES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function navigationTypeName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
