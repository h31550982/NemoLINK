/**
 * The place in the port when there is nothing to choose (user 2026-11-13):
 * a port with one published area gets that area, an area with one berth
 * gets that berth. Only an empty field is filled; the fields stay on the
 * form, so the pick shows and can be changed. The server applies the same
 * rule on every save (server/src/canonical/only-place.ts).
 */

export interface PlaceArea {
  code: string;
  berths: { code: string }[];
}

export interface Place {
  portAreaCode: string | null;
  berth: string | null;
}

export function onlyPlace(areas: readonly PlaceArea[], place: Place): Place {
  let area = place.portAreaCode || null;
  const berth = place.berth || null;
  // A berth names its area
  if (!area && berth) area = areas.find((a) => a.berths.some((b) => b.code === berth))?.code ?? null;
  if (!area && areas.length === 1) area = areas[0]!.code;
  if (berth || !area) return { portAreaCode: area, berth };
  const berths = areas.find((a) => a.code === area)?.berths ?? [];
  return { portAreaCode: area, berth: berths.length === 1 ? berths[0]!.code : null };
}
