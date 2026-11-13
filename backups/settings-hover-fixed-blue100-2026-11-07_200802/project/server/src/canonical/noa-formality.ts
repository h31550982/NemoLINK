/**
 * The NOA as NEMO takes it (spec 0088): the pre-arrival notice built from
 * the same snapshot its checklist shows (spec 0087), so the panel and the
 * send never disagree. Shape: vendored MIG 2.0.1.0 NOA schema, element
 * paths from vendor/nemo/hub/de-index.json, checked against the set NEMO
 * accepted live (spec 0063, visit -058-8): previous port at sequence -1,
 * next at 1, measures as {$, @unitCode}.
 *
 * The arrival confirmation (DE-003-07, ST-FI-01) goes only when the sender
 * says so: it cannot be withdrawn, and Fintraffic's guide says to confirm
 * once the other arrival reports are in. Without it the NOA is accepted
 * but unconfirmed, and NEMO refuses the ATA until it is confirmed.
 *
 * The ship's length overall, breadth and gross / net / deadweight tonnage go
 * with it whenever NEMOLink has them: NEMO refuses a NOA without them (ERR-029)
 * while its ship database lacks them — the SHP sent with the VID carries
 * only the FI-required set (live, STG 2026-10-06, visit -033-3).
 *
 * Not sent: the fairway dues decision language — no element carries it in
 * the Declarant API (spec 0088, open question).
 */

import { NEXT_PORT_UNKNOWN, type ObligationSnapshot } from './obligations';
import { noaCallFacts } from './noa-facts';

export const ARRIVAL_CONFIRMATION = 'ST-FI-01';
/** UN/EDIFACT 8067: maritime transport. */
const MODE_MARITIME = '1';

/** The NOA data section (`noa:NOA`) for this call; `confirm` adds ST-FI-01. */
export function buildNoaPayload(snap: ObligationSnapshot, confirm: boolean): Record<string, unknown> {
  // Entered here, else the sources: the same values the checklist shows (spec 0090)
  const f = noaCallFacts(snap);
  const n = {
    crew: f.crew.toNemo,
    personsOnBoard: f.personsOnBoard.toNemo,
    maxDraught: f.maxDraught.toNemo,
    masterFamilyName: f.masterFamilyName.toNemo,
    masterGivenNames: f.masterGivenNames.toNemo,
  };
  const s = snap.ship;
  const fields = (s?.fields ?? {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const put = (target: Record<string, unknown>, key: string, value: unknown): void => {
    if (value !== null && value !== undefined) target[key] = value;
  };

  const movement: Record<string, unknown> = { 'ram:ModeCode': MODE_MARITIME };
  put(movement, 'ram:CrewQuantity', count(n.crew));
  put(movement, 'ram:OnboardPersonQuantity', count(n.personsOnBoard));
  const purposes = Array.isArray(f.purposeOfCall.toNemo) ? (f.purposeOfCall.toNemo as string[]) : [];
  if (purposes.length > 0) movement['ram:CallPurposeCode'] = purposes;
  put(movement, 'ram:VoyageTypeServiceCode', f.voyageType.toNemo);

  const callEvent: Record<string, unknown> = {};
  put(callEvent, 'ram:EstimatedTransportMeansArrivalOccurrenceDateTime', snap.eta);
  put(callEvent, 'ram:EstimatedTransportMeansDepartureOccurrenceDateTime', snap.etd);
  if (text(snap.portAreaCode)) {
    callEvent['ram:ExpectedArrivalPortAreaRelatedLogisticsLocation'] = { 'ram:Name': text(snap.portAreaCode) };
  }
  movement['ram:CallTransportEvent'] = callEvent;

  if (text(snap.berth)) {
    movement['ram:ArrivalTransportEvent'] = {
      'ram:OccurrenceLogisticsLocation': { 'ram:SubordinateLocation': { 'ram:Name': text(snap.berth) } },
    };
  }

  // Last port at -1; the next is always ZZUKN at 1 (user decision 2026-09-26)
  const stops: Record<string, unknown>[] = [];
  const last = typeof f.lastPort.toNemo === 'string' ? f.lastPort.toNemo : null;
  if (last) stops.push({ 'ram:SequenceNumeric': -1, 'ram:OccurrenceLogisticsLocation': { 'ram:ID': last } });
  stops.push({ 'ram:SequenceNumeric': 1, 'ram:OccurrenceLogisticsLocation': { 'ram:ID': NEXT_PORT_UNKNOWN } });
  movement['ram:ItineraryTransportRoute'] = { 'ram:ItineraryStopTransportEvent': stops };

  const family = text(n.masterFamilyName);
  const given = text(n.masterGivenNames);
  if (family && given) {
    movement['ram:MasterResponsibleTransportPerson'] = { 'ram:FamilyName': family, 'ram:GivenName': given };
  }

  const means: Record<string, unknown> = {};
  put(means, 'ram:TypeCode', text(s?.typeCode));
  if (text(s?.flagState)) means['ram:RegistrationTradeCountry'] = { 'ram:ID': text(s?.flagState) };
  const registry = text(fields['registryCode']);
  const registryPort = text(fields['registryPort']);
  if (registry) {
    means['ram:RegistrationTransportEvent'] = {
      'ram:CertifyingTradeParty': { 'ram:ID': registry },
      ...(registryPort ? { 'ram:OccurrenceLogisticsLocation': { 'ram:ID': registryPort } } : {}),
    };
  }
  if (count(n.maxDraught) !== null) {
    means['ram:ActualMaximumDraughtLevelMeasure'] = { $: count(n.maxDraught), '@unitCode': 'MTR' };
  }
  // Units as the MIG enumerates them: GT, NT, TNE, MTR
  const measure = (key: string, value: unknown, unit: string): void => {
    const v = count(value);
    if (v !== null) means[key] = { $: v, '@unitCode': unit };
  };
  measure('ram:OverallLengthMeasure', s?.length, 'MTR');
  measure('ram:WidthMeasure', s?.width, 'MTR');
  measure('ram:GrossTonnageMeasure', s?.grossWeight, 'GT');
  measure('ram:NetTonnageMeasure', s?.netWeight, 'NT');
  measure('ram:DeadWeightMeasure', fields['dwt'], 'TNE');
  if (Object.keys(means).length > 0) movement['ram:UsedLogisticsTransportMeans'] = means;

  // The agent: identification and name, and the contact NEMO requires with it
  const agent: Record<string, unknown> = {};
  put(agent, 'ram:ID', text(snap.org.agentId));
  put(agent, 'ram:Name', text(snap.org.agencyName ?? snap.org.name));
  const mobile = text(snap.org.agentMobile);
  const email = text(snap.org.agentEmail);
  if (mobile && email) {
    agent['ram:DefinedTradeContact'] = {
      'ram:MobileTelephoneUniversalCommunication': { 'ram:CompleteNumber': mobile },
      'ram:EmailURIUniversalCommunication': { 'ram:URIID': email },
    };
  }
  if (Object.keys(agent).length > 0) movement['ram:CarrierAgentTradeParty'] = [agent];

  return {
    ...(confirm ? { 'noa:ExchangedDeclaration': { 'ram:StatementTypeCode': ARRIVAL_CONFIRMATION } } : {}),
    'noa:SpecifiedLogisticsTransportMovement': movement,
  };
}
