import { randomUUID } from 'node:crypto';
import { MIG_SCHEMAS, MIG_VERSION } from './generated/mig-schemas';

export interface MaiDeclarant {
  /** EORI / business id, e.g. 'FI1979903-5' */
  id: string;
  /** Party role code (codelist party_role) */
  roleCode: string;
  name?: string;
}

export interface MaiEnvelopeInput {
  /** e.g. 'NOA' — must be a vendored MIG type */
  formalityType: string;
  declarant: MaiDeclarant;
  /** NEMO visit id, e.g. 'FI20260213-003' */
  visitId: string;
  /** The formality data section (the object placed at `<t>:<TYPE>`) */
  payload: object;
  /** UN/EDIFACT 1225 message function; default '9' = original */
  purposeCode?: string;
  /** LRN — required by NEMO for multi-instance formality types */
  declarationId?: string;
}

/**
 * Builds the MAI message envelope centrally (docs/02, docs/04): formality modules
 * only produce the data section. Field set mirrors the MIG schemas' required MAI
 * tree. Optional elements are omitted entirely when absent — never sent as '',
 * 0, or null.
 *
 * No `@xmlns:*` keys (NEMO support, 2026-10-06): with the declarations ahead of
 * `env:Envelope` every MAI formality got 400 INTERNAL_ERROR on STG; without
 * them (or with them after the envelope) the same SID/COA is accepted. The MIG
 * schemas list them but require none.
 */
export function buildMaiEnvelope(input: MaiEnvelopeInput): Record<string, unknown> {
  const type = input.formalityType;
  if (!MIG_SCHEMAS[type]) {
    throw new Error(`Unknown formality type '${type}' (MIG ${MIG_VERSION})`);
  }

  const envelope: Record<string, unknown> = {};
  envelope['env:Envelope'] = {
    'mai:MAI': {
      'mai:ExchangedDocument': {
        'ram:ID': randomUUID(),
        'ram:TypeCode': type,
        'ram:PurposeCode': input.purposeCode ?? '9',
        'ram:VersionID': '2.0',
        'ram:FirstSignatoryDocumentAuthentication': {
          'ram:FormattedActualDateTime': new Date().toISOString(),
        },
      },
      'mai:ExchangedDeclaration': {
        ...(input.declarationId ? { 'ram:ID': input.declarationId } : {}),
        'ram:DeclarantTradeParty': {
          'ram:ID': input.declarant.id,
          'ram:RoleCode': input.declarant.roleCode,
          ...(input.declarant.name ? { 'ram:Name': input.declarant.name } : {}),
        },
      },
      'mai:SpecifiedLogisticsTransportMovement': {
        'ram:CallTransportEvent': { 'ram:ID': input.visitId },
      },
    },
    [`${type.toLowerCase()}:${type}`]: input.payload,
  };
  return envelope;
}
