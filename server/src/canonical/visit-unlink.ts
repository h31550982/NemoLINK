/**
 * A visit NEMO cancelled (2026-10-06, user decision): the port call here is
 * unlinked from it — visit id cleared, its VID unsent again — and the old
 * visit with every report sent under it moves to data.nemo.previousVisits;
 * the chain gets nemo_visit_unlinked. One write for every path that finds
 * out: a send's visit check, a COA answered ERR-023, the hourly visit watch
 * (docs/specs/0097).
 */

import type { PoolClient } from 'pg';
import type { AuditService } from '../audit/audit.service';

/**
 * Has NEMO cancelled the visit? Its formality list says so: a COA that is not
 * withdrawn, or the VID invalidated (NEMO invalidates it with the COA).
 */
export function visitCancelledIn(list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((x: { formalityType?: unknown; status?: unknown }) => {
    const status = String(x?.status ?? '').toUpperCase();
    return (x?.formalityType === 'COA' && status !== 'WITHDRAWN') || (x?.formalityType === 'VID' && status === 'INVALIDATED');
  });
}

export interface UnlinkInput {
  actorId: string;
  portCallId: string;
  visitId: string;
  shipId: string | null;
  reason: string;
  schema: string;
}

/** Unlinks the call — only while it still carries that visit id, so a second finder is a no-op. */
export async function unlinkVisit(client: PoolClient, audit: AuditService, x: UnlinkInput): Promise<boolean> {
  const r = await client.query(
    `UPDATE port_call SET
       visit_id = NULL,
       data = data || jsonb_build_object('nemo', jsonb_build_object('previousVisits',
                COALESCE(data->'nemo'->'previousVisits', '[]'::jsonb) || jsonb_build_array(
                  (COALESCE(data->'nemo', '{}'::jsonb) - 'previousVisits') || $2::jsonb))),
       updated = now()
     WHERE id = $1 AND visit_id = $3`,
    [x.portCallId, JSON.stringify({ visitId: x.visitId, unlinkedAt: new Date().toISOString(), reason: x.reason }), x.visitId],
  );
  if ((r.rowCount ?? 0) === 0) return false;
  await audit.content(
    {
      actorId: x.actorId,
      entityType: 'port_call',
      entityId: x.portCallId,
      data: { action: 'nemo_visit_unlinked', visitId: x.visitId, shipId: x.shipId, reason: x.reason },
      schema: x.schema,
    },
    client,
  );
  return true;
}
