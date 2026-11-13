/**
 * What goes to NEMO for a ship, as one organisation sees it (specs 0061 /
 * 0068): the org's live overrides on top of the master record — To NEMO =
 * override ?? master. Pure; the ship dialog's rows (admin/ships.service)
 * and the port-call report checklists (spec 0075) both resolve through it,
 * so a checklist never counts a value the org has corrected.
 */

import {
  FieldOverride,
  OVERRIDES_KEY,
  PARTICULARS_KEY_SET,
  applyCertSupersession,
  certExpiryKey,
  overridesOf,
} from './ship-lanes';
import {
  ShipCertificateRow,
  ShipParticulars,
  certificatesFromData,
  particularsFromData,
} from './ship-master-data';

export interface ResolvedShip {
  name: string | null;
  mmsi: string | null;
  callSign: string | null;
  particulars: ShipParticulars;
  certificates: ShipCertificateRow[];
  /** The org's overrides with the rule-6 flags (spec 0061), author org included. */
  overrides: Record<string, FieldOverride>;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * @param master   the master record's `data` (platform.ship.data)
 * @param fleetData the org's fleet row `data` (fleet_ship.data) — null when
 *                  the ship is not in the fleet: the master values stand
 * @param identity the master's identity columns
 */
export function resolveShip(
  master: Record<string, unknown>,
  fleetData: unknown,
  identity: { name: string | null; mmsi: string | null; callSign: string | null },
): ResolvedShip {
  const overrides = overridesOf(
    applyCertSupersession({ ...master, [OVERRIDES_KEY]: asObject(asObject(fleetData)[OVERRIDES_KEY]) })
      .data,
  );
  const live = (key: string): FieldOverride | undefined => {
    const o = overrides[key];
    return o && !o.superseded ? o : undefined;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const pick = (key: 'name' | 'mmsi' | 'callSign', masterValue: string | null): string | null => {
    const o = live(key);
    return o ? str(o.value) : masterValue;
  };
  const particulars: ShipParticulars = { ...particularsFromData(master) };
  for (const [key, o] of Object.entries(overrides)) {
    if (!PARTICULARS_KEY_SET.has(key) || o.superseded) continue;
    if (o.value === null || o.value === undefined) delete (particulars as Record<string, unknown>)[key];
    else (particulars as Record<string, unknown>)[key] = o.value;
  }
  const certificates = certificatesFromData(master).map((c) => {
    const o = live(certExpiryKey(c.typeCode, c.certificateId));
    return o ? { ...c, expiryDate: str(o.value) } : c;
  });
  return {
    name: pick('name', identity.name),
    mmsi: pick('mmsi', identity.mmsi),
    callSign: pick('callSign', identity.callSign),
    particulars,
    certificates,
    overrides,
  };
}
