/**
 * Captain's PEC model (docs/specs/0045, refines 0043). Stored as
 * platform.user_account.pec jsonb:
 *   null            — the captain has not answered yet (first-login ask)
 *   {none: true}    — declared: no PEC licence for Finland
 *   {number, type?, regions?, ports?, validUntil?} — the certificate
 *
 * The number is MIG-bounded 1–10 chars (NOA/NOD
 * ram:PilotExemptionCertificate ram:ID); validUntil maps to
 * ram:ExpiryDate. Restricted/unrestricted and the coverage lists are
 * operational data — no vendored codelist exists for Finnish VTS areas
 * (open question 7d), so the area list is pinned here from the user
 * decision 2026-08-24.
 */

import { z } from 'zod';
import { fiLocode } from '../ingest/envelope.schema';

export const PEC_REGIONS = [
  'archipelago',
  'bothnia',
  'hanko',
  'helsinki',
  'kotka',
  'saimaa',
  'west-coast',
] as const;

export const PEC_REGION_NAMES: Record<(typeof PEC_REGIONS)[number], string> = {
  archipelago: 'Archipelago VTS',
  bothnia: 'Bothnia VTS',
  hanko: 'Hanko VTS',
  helsinki: 'Helsinki VTS',
  kotka: 'Kotka VTS',
  saimaa: 'Saimaa VTS',
  'west-coast': 'West Coast VTS',
};

const pecDetailsSchema = z
  .object({
    number: z.string().trim().min(1).max(10),
    type: z.enum(['restricted', 'unrestricted']).optional(),
    regions: z.array(z.enum(PEC_REGIONS)).max(PEC_REGIONS.length).optional(),
    ports: z.array(fiLocode).max(100).optional(),
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'validUntil must be YYYY-MM-DD')
      .optional(),
  })
  .strict();

export const pecInfoSchema = z.union([
  z.object({ none: z.literal(true) }).strict(),
  pecDetailsSchema,
]);

export type PecInfo = z.infer<typeof pecInfoSchema>;

/** Drops empty coverage arrays so the stored document stays minimal. */
export function normalizePec(pec: PecInfo): PecInfo {
  if ('none' in pec) return pec;
  const out: PecInfo = { number: pec.number };
  if (pec.type) out.type = pec.type;
  if (pec.regions && pec.regions.length > 0) out.regions = pec.regions;
  if (pec.ports && pec.ports.length > 0) out.ports = pec.ports;
  if (pec.validUntil) out.validUntil = pec.validUntil;
  return out;
}
