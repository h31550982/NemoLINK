/**
 * The ATA (actual arrival) as NEMO takes it (spec 0092): the time the ship
 * arrived, and that the call was not at an anchorage. Shape: vendored MIG
 * 2.0.1.0 ATA schema, the set NEMO accepted live (spec 0063, visit -058-8).
 * NEMO refuses it before the NOA and the DUE, and until the NOA carries the
 * customs confirmation (ST-FI-01) — the ATA step sends that first (D1).
 * From an accepted ATA on, NEMO locks the NOA (NOA_UPDATE_NOT_ALLOWED).
 */

/** The ATA data section (`ata:SpecifiedLogisticsTransportMovement`), arrived at `at` (ISO). */
export function buildAtaPayload(at: string): Record<string, unknown> {
  return {
    'ata:SpecifiedLogisticsTransportMovement': {
      'ram:CallTransportEvent': {
        // DE-014-15: not a call at an anchorage (0)
        'ram:MaritimeAnchorageIndicator': 0,
        'ram:ActualArrivalRelatedDateTime': at,
      },
    },
  };
}
