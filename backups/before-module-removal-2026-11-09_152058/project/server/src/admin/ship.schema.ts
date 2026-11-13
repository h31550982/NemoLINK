/**
 * Ship master-data validation (docs/specs/0017, certificates 0020,
 * particulars 0036). Same identifier rules as the portcall schema: IMO 7
 * digits with its check digit (spec 0077), MMSI 9 digits. Certificate type codes, ship type codes and ice
 * classes are validated against the vendored contracts (see
 * canonical/ship-master-data.ts) — never a hand-copied list.
 */

import { z } from 'zod';
import { imoNumberSchema } from '../canonical/imo';
import {
  shipCertificateSchema,
  shipParticularsSchema,
} from '../canonical/ship-master-data';

export { shipCertificateSchema };

/**
 * A certificate as a person enters it: not issued in the future, and not
 * expiring before it was issued. A day of grace for the issue date — Finnish
 * today runs ahead of UTC. Ingest keeps the plain schema: a source's odd
 * date is shown, not refused.
 */
export const enteredCertificateSchema = shipCertificateSchema.superRefine((c, ctx) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (c.issueDate && c.issueDate > tomorrow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['issueDate'], message: 'The issue date cannot be in the future' });
  }
  if (c.issueDate && c.expiryDate && c.expiryDate < c.issueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: 'The expiry date cannot be before the issue date' });
  }
});
export { CERTIFICATE_TYPE_CODES } from '../canonical/ship-master-data';
export type { ShipCertificate } from '../canonical/ship-master-data';

export const shipCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    imoNumber: imoNumberSchema.optional(),
    mmsi: z.string().regex(/^\d{9}$/, 'MMSI is 9 digits').optional(),
    callSign: z.string().min(1).max(20).optional(),
    certificates: z.array(enteredCertificateSchema).max(100).optional(),
    // NSD-mirror particulars (spec 0036): fields present are set, null clears
    particulars: shipParticularsSchema.optional(),
  })
  .strict();

export const shipUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    imoNumber: imoNumberSchema.nullable().optional(),
    mmsi: z.string().regex(/^\d{9}$/, 'MMSI is 9 digits').nullable().optional(),
    callSign: z.string().min(1).max(20).nullable().optional(),
    // Replaces the whole set; [] clears, absent leaves untouched (spec 0020)
    certificates: z.array(enteredCertificateSchema).max(100).optional(),
    particulars: shipParticularsSchema.optional(),
  })
  .strict();

/** Drop the operator's override and use the latest external value (spec 0061). */
export const shipUseSourceSchema = z
  .object({ field: z.string().min(1).max(120) })
  .strict();

/** Master-list search (spec 0068): name or IMO, two characters or more. */
export const shipSearchSchema = z.object({ q: z.string().trim().min(2).max(60) }).strict();

export type ShipCreate = z.infer<typeof shipCreateSchema>;
export type ShipUpdate = z.infer<typeof shipUpdateSchema>;

/** Send the ship data as the SID and SHP of this port call (spec 0070). */
export const shipNemoSendSchema = z.object({ portCallId: z.string().uuid() }).strict();
export type ShipNemoSend = z.infer<typeof shipNemoSendSchema>;
