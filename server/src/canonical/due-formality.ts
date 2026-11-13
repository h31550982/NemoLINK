/**
 * The DUE (fairway and port dues) as NEMO takes it (spec 0092): sent with
 * the NOA — the user's flow puts the pre-arrival reports under the NOA —
 * and needed before the ATA (DUE_MUST_BE_SUBMITTED_BEFORE_ATA). Shape:
 * vendored MIG 2.0.1.0 DUE schema, checked against the set NEMO accepted
 * live (spec 0063, visit -058-8): the agency as the liable party, not
 * jointly liable, with its postal address. The DUE carries an LRN (NEMO's
 * LRN list), which the send loop keeps with the fact.
 */

import type { ObligationSnapshot } from './obligations';

/** The DUE data section (`due:SpecifiedLogisticsTransportMovement`) for this call. */
export function buildDuePayload(snap: ObligationSnapshot): Record<string, unknown> {
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const o = snap.org;
  const party: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    if (value !== null && value !== undefined) party[key] = value;
  };
  put('ram:ID', text(o.businessId));
  put('ram:Name', text(o.agencyName ?? o.name));
  if (text(o.agentEmail)) party['ram:EmailURIUniversalCommunication'] = { 'ram:URIID': text(o.agentEmail) };

  const address: Record<string, unknown> = {};
  if (text(o.street)) address['ram:StreetName'] = text(o.street);
  // Postcodes by the national postal authority (UN/EDIFACT 3055: 5), as accepted live
  if (text(o.postcode)) address['ram:PostcodeCode'] = { $: text(o.postcode), '@listAgencyID': '5' };
  if (text(o.city)) address['ram:CityName'] = { $: text(o.city), '@languageID': 'FI' };
  if (text(o.countryCode)) address['ram:CountryID'] = text(o.countryCode);
  if (Object.keys(address).length > 0) party['ram:PostalTradeAddress'] = address;

  return {
    'due:SpecifiedLogisticsTransportMovement': {
      'ram:CallTransportEvent': {
        'ram:ApplicableSpecifiedFairwayPortDues': {
          // The agency alone is liable (DE-077-21: 0)
          'ram:PartyJointLiabilityIndicator': 0,
          'ram:LiableTradeParty': party,
        },
      },
    },
  };
}
