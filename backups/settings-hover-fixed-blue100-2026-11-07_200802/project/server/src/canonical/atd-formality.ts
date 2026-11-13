/**
 * The ATD (actual departure) as NEMO takes it (spec 0092): the time the
 * ship left. Shape: vendored MIG 2.0.1.0 ATD schema, the set NEMO accepted
 * live (spec 0063). NEMO refuses it before the NOD and the ATA (ERR-021),
 * and until the NOD carries the departure confirmation (ST-FI-02) — the ATD
 * step sends that first, as the ATA step does for the arrival.
 */

/** The ATD data section (`atd:SpecifiedLogisticsTransportMovement`), departed at `at` (ISO). */
export function buildAtdPayload(at: string): Record<string, unknown> {
  return {
    'atd:SpecifiedLogisticsTransportMovement': {
      'ram:CallTransportEvent': { 'ram:ActualDepartureRelatedDateTime': at },
    },
  };
}
