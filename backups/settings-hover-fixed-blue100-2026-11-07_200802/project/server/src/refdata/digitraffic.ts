/**
 * Digitraffic port call visits (docs/specs/0068): the public, NEMO-fed feed
 * of active visits in Finnish ports — `GET /api/port-call/v2/visits` on
 * meri.digitraffic.fi (the v1 routes are the Portnet era and stay unused).
 * Each visit names the ship by IMO (`vesselId`) and name, so the master
 * list grows from it and the "upcoming calls" scan knows which ships to
 * ask NEMO about. The service requires `Accept-Encoding: gzip` (406
 * otherwise) and asks callers to identify with a `Digitraffic-User` header.
 */

export interface DigitrafficVisit {
  visitId: string;
  /** Seven-digit IMO number; null when the visit carries none. */
  imo: string | null;
  name: string | null;
  portOfCall: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  /** As the feed spells it: "Expected to Arrive", "Arrived", "Departed", "Cancelled". */
  status: string;
  updateTime: string;
}

export interface DigitrafficVisitsParse {
  visits: DigitrafficVisit[];
  received: number;
  /** Visits without a usable IMO (counted, never a failure). */
  withoutImo: number;
}

export type DigitrafficFetcher = (url: string, user: string) => Promise<string>;

const DEFAULT_URL = 'https://meri.digitraffic.fi';
const DEFAULT_USER = 'nemolink';
const TIMEOUT_MS = 30_000;

export function digitrafficVisitsUrl(base: string | undefined): string {
  return (base || DEFAULT_URL).replace(/\/+$/, '') + '/api/port-call/v2/visits';
}

export function digitrafficUser(user: string | undefined): string {
  return user || DEFAULT_USER;
}

/** The default fetcher: one GET with the two headers the service wants. */
export async function fetchDigitraffic(url: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'Digitraffic-User': user,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Digitraffic responded ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Parse the feed; a row without a visit id is skipped, one without an IMO is counted. */
export function parseDigitrafficVisits(text: string): DigitrafficVisitsParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Digitraffic visits: response is not JSON');
  }
  if (!Array.isArray(raw)) {
    throw new Error('Digitraffic visits: expected a JSON array');
  }
  const visits: DigitrafficVisit[] = [];
  let withoutImo = 0;
  for (const item of raw) {
    const v = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const visitId = str(v['visitId']);
    if (!visitId) continue;
    const rawImo = str(v['vesselId']);
    const imo = rawImo && /^\d{7}$/.test(rawImo) ? rawImo : null;
    if (!imo) withoutImo++;
    visits.push({
      visitId,
      imo,
      name: str(v['vesselName']),
      portOfCall: str(v['portOfCall']),
      eta: str(v['eta']),
      etd: str(v['etd']),
      ata: str(v['ata']),
      atd: str(v['atd']),
      status: str(v['status']) ?? '',
      updateTime: str(v['updateTime']) ?? new Date().toISOString(),
    });
  }
  return { visits, received: raw.length, withoutImo };
}

/** Ships worth asking NEMO about: a live visit with a time still ahead. */
export function upcomingImos(visits: DigitrafficVisit[], now: number): string[] {
  const out = new Set<string>();
  for (const v of visits) {
    if (!v.imo) continue;
    if (/cancel/i.test(v.status)) continue;
    const ahead = [v.eta, v.etd].some((t) => t !== null && Date.parse(t) >= now);
    if (ahead) out.add(v.imo);
  }
  return [...out];
}
