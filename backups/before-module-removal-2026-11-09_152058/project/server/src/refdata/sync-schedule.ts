/**
 * When the worker's refdata syncs run: the reference lists weekly, Monday
 * 12:00 Finnish time (Europe/Helsinki, DST included), the ship master list
 * daily at 05:00 UTC. Pure date math, kept apart from the worker so it can be
 * tested.
 */

const ZONE = 'Europe/Helsinki';
const WEEKDAY = 1; // Monday (Sunday = 0)
const HOUR = 12;

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** The zone's wall clock at `at`, read as if it were UTC. */
function wallClock(at: Date): Date {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return new Date(
    Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!),
  );
}

/** The instant the zone's wall clock reads `wall` (read as UTC). */
function fromWallClock(wall: Date): Date {
  const guess = new Date(wall.getTime() - (wallClock(wall).getTime() - wall.getTime()));
  // Second pass settles a guess that crossed a DST change
  return new Date(wall.getTime() - (wallClock(guess).getTime() - guess.getTime()));
}

/** The latest Monday 12:00 Helsinki at or before `now`. */
function previousWeeklySlot(now: Date): Date {
  const wall = wallClock(now);
  const slot = new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), HOUR),
  );
  slot.setUTCDate(slot.getUTCDate() - ((wall.getUTCDay() - WEEKDAY + 7) % 7));
  if (slot > wall) slot.setUTCDate(slot.getUTCDate() - 7);
  return fromWallClock(slot);
}

/** The first Monday 12:00 Helsinki strictly after `now`. */
export function nextWeeklySlot(now: Date): Date {
  // A week and two hours on lands on next Monday afternoon whichever way a
  // DST change in between moved the clock
  return previousWeeklySlot(new Date(previousWeeklySlot(now).getTime() + (7 * 24 + 2) * 3_600_000));
}

/** The first 05:00 UTC strictly after `now` (the ship master list). */
export function nextDailyShipsSlot(now: Date): Date {
  const slot = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5),
  );
  if (slot <= now) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}
