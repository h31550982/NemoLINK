/**
 * The NOD (pre-departure notice) as NEMO takes it (spec 0092): the set NEMO
 * accepted live (spec 0063, attempt ND2) — the ETD, the next port at
 * sequence 1, the crew and the persons on board — plus the voyage number
 * when the call has one. Shape: vendored MIG 2.0.1.0 NOD schema.
 *
 * The departure confirmation (DE-003-07, ST-FI-02) mirrors the arrival's
 * (D1): the NOD goes unconfirmed, and the ATD step sends it as a NOD update
 * first. NEMO refuses the ATD until the NOD carries it (ERR-003).
 */

import { NEXT_PORT_UNKNOWN, type ObligationSnapshot } from './obligations';
import { noaCallFacts } from './noa-facts';

export const DEPARTURE_CONFIRMATION = 'ST-FI-02';

/** The next port the NOD names: the call's own next port, else unknown (ZZUKN). */
export function nodNextPort(snap: ObligationSnapshot): string {
  return snap.nextPorts?.[0] ?? NEXT_PORT_UNKNOWN;
}

/** The NOD data section (`nod:…`) for this call; `confirm` adds ST-FI-02. */
export function buildNodPayload(snap: ObligationSnapshot, confirm: boolean): Record<string, unknown> {
  // The same crew and persons on board the NOA carries (spec 0090 resolver)
  const f = noaCallFacts(snap);
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const movement: Record<string, unknown> = {};
  if (typeof snap.voyageNumber === 'string' && snap.voyageNumber.trim()) movement['ram:ID'] = snap.voyageNumber.trim();
  const crew = count(f.crew.toNemo);
  const persons = count(f.personsOnBoard.toNemo);
  if (crew !== null) movement['ram:CrewQuantity'] = crew;
  if (persons !== null) movement['ram:OnboardPersonQuantity'] = persons;
  if (snap.etd) movement['ram:CallTransportEvent'] = { 'ram:EstimatedTransportMeansDepartureOccurrenceDateTime': snap.etd };
  movement['ram:ItineraryTransportRoute'] = {
    'ram:ItineraryStopTransportEvent': [
      { 'ram:SequenceNumeric': 1, 'ram:OccurrenceLogisticsLocation': { 'ram:ID': nodNextPort(snap) } },
    ],
  };
  return {
    ...(confirm ? { 'nod:ExchangedDeclaration': { 'ram:StatementTypeCode': DEPARTURE_CONFIRMATION } } : {}),
    'nod:SpecifiedLogisticsTransportMovement': movement,
  };
}
