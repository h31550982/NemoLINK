/**
 * The place in the port when there is nothing to choose (user 2026-11-13):
 * a port with one published area gets that area, an area with one berth
 * gets that berth. Only what the call leaves empty is filled — a value the
 * call already holds, or one picked by a person, always stands. The fields
 * stay on the forms; they simply arrive filled.
 *
 * The app mirrors this in app/src/lib/only-place.ts so the form shows the
 * pick at once. Pure: no IO.
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
