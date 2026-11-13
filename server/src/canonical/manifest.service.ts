/**
 * Applying a source manifest (spec 0055) — how NEMOLink notices that a port
 * call was deleted at its source.
 *
 * A delta push cannot report a row that no longer exists, so a source that
 * hard-deletes (opsDesk does, and has no cancelled status) can silently leave
 * stale declarations behind. The manifest closes that hole by stating what the
 * source holds for a window. The rule that makes it safe: **absence is only
 * meaningful inside a manifest**. A crashed run sends none, so nothing is
 * swept; silence still means "no information".
 *
 * Nothing here deletes. A call the source dropped is deactivated only when
 * nobody here has touched it; anything carrying documents, a visit id or real
 * actuals is kept and flagged for a person.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { ManifestEnvelope } from '../ingest/envelope.schema';

/**
 * A manifest that would remove more than this share of the calls it covers is
 * held for a human instead of applied: wholesale disappearance is far likelier
 * to be a bug at the source than a week of real cancellations. The absolute
 * floor keeps tiny windows from tripping it — one deletion out of three is an
 * ordinary day, not an incident.
 */
export const REMOVAL_SHARE_LIMIT = 0.2;
export const REMOVAL_FLOOR = 5;

/** How far apart two calls' ETAs may sit and still be judged the same call. */
export const ADOPTION_ETA_TOLERANCE_HOURS = 36;

export type ManifestAction = 'manifest_applied' | 'manifest_held';

export interface ManifestOutcome {
  action: ManifestAction;
  /** Calls in the window the manifest spoke about or should have. */
  covered: number;
  /** Still at source but not pushed — flagged, never deactivated. */
  withheld: number;
  /** Gone at source, untouched here — deactivated. */
  deactivated: number;
  /** Gone at source but worked on here — kept and flagged. */
  retained: number;
  /** Deleted and recreated: identity moved onto the existing call. */
  adopted: number;
  warnings?: string[];
}

interface HeldCall {
  id: string;
  source_call_id: string;
  ship_id: string | null;
  port_locode: string | null;
  eta: Date | null;
  /** Anything a person did here, collapsed to one flag by the query. */
  touched: boolean;
}

/** The columns that decide whether a call is still purely the source's to retract. */
const HELD_CALL_SQL = `
  SELECT pc.id, pc.source_call_id, pc.ship_id, pc.port_locode, pc.eta,
         (pc.visit_id IS NOT NULL
          OR pc.ata IS NOT NULL
          OR pc.atd IS NOT NULL
          OR pc.status IS DISTINCT FROM 'expected'
          OR EXISTS (SELECT 1 FROM port_call_document d
                      WHERE d.port_call_id = pc.id AND d.is_active)
         ) AS touched
    FROM port_call pc
   WHERE pc.source = $1
     AND pc.is_active
     AND pc.source_call_id IS NOT NULL
     AND pc.eta IS NOT NULL
     AND pc.eta >= $2
     AND pc.eta < $3`;

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(private readonly audit: AuditService) {}

  async apply(
    client: PoolClient,
    schema: string,
    envelope: ManifestEnvelope,
    sourceRecordId: string,
  ): Promise<ManifestOutcome> {
    const { windowFrom, windowTo, entries } = envelope.payload;
    const stated = new Map(entries.map((e) => [e.sourceCallId, e]));

    // A call with no ETA cannot be placed in the window, so it is never
    // swept — we would be guessing, and guessing here deactivates real work.
    const held = await client.query<HeldCall>(HELD_CALL_SQL, [
      envelope.sourceSystem,
      windowFrom,
      windowTo,
    ]);

    const withheld: HeldCall[] = [];
    const absent: HeldCall[] = [];
    for (const call of held.rows) {
      const entry = stated.get(call.source_call_id);
      if (!entry) {
        absent.push(call);
      } else if (entry.disposition === 'withheld') {
        withheld.push(call);
      }
      // 'sent' needs nothing: the content push already applied it.
    }

    const outcome: ManifestOutcome = {
      action: 'manifest_applied',
      covered: held.rows.length,
      withheld: withheld.length,
      deactivated: 0,
      retained: 0,
      adopted: 0,
    };

    // The circuit breaker runs before any write: a held manifest changes
    // nothing at all, so an admin sees the state the source claims to have
    // left behind rather than the wreckage of applying it.
    if (
      absent.length >= REMOVAL_FLOOR &&
      held.rows.length > 0 &&
      absent.length / held.rows.length > REMOVAL_SHARE_LIMIT
    ) {
      this.logger.warn(
        `manifest ${envelope.sourceSystem}/${envelope.eventId} held: ` +
          `${absent.length} of ${held.rows.length} calls would be removed`,
      );
      const outcomeHeld: ManifestOutcome = {
        ...outcome,
        action: 'manifest_held',
        withheld: 0,
        warnings: ['manifest_held'],
      };
      await this.record(client, schema, envelope, sourceRecordId, outcomeHeld, []);
      return outcomeHeld;
    }

    for (const call of withheld) {
      // Still there, just not ours to declare today. Flagged, never
      // deactivated — the source did not retract it.
      await client.query(
        `UPDATE port_call
            SET data = data || jsonb_build_object('sourceWithheld', $2::jsonb),
                updated = now()
          WHERE id = $1`,
        [
          call.id,
          JSON.stringify({
            at: envelope.occurredAt,
            reason: stated.get(call.source_call_id)?.reason ?? null,
            manifestEventId: envelope.eventId,
          }),
        ],
      );
    }

    const deactivated: string[] = [];
    for (const call of absent) {
      const adopted = await this.tryAdopt(client, envelope, call, stated);
      if (adopted) {
        outcome.adopted += 1;
        continue;
      }
      const withdrawn = JSON.stringify({
        at: envelope.occurredAt,
        manifestEventId: envelope.eventId,
      });
      if (call.touched) {
        // Documents, a visit id or real actuals: somebody worked on this, and
        // the source does not get to erase that. Kept, marked, surfaced.
        await client.query(
          `UPDATE port_call
              SET data = data || jsonb_build_object('sourceWithdrawn', $2::jsonb),
                  updated = now()
            WHERE id = $1`,
          [call.id, withdrawn],
        );
        outcome.retained += 1;
      } else {
        // Untouched: the source may retract its own speculative plan. Soft,
        // audited, reversible — never a DELETE.
        await client.query(
          `UPDATE port_call
              SET is_active = false,
                  data = data || jsonb_build_object('sourceWithdrawn', $2::jsonb),
                  updated = now()
            WHERE id = $1`,
          [call.id, withdrawn],
        );
        deactivated.push(call.id);
        outcome.deactivated += 1;
      }
    }

    await this.record(client, schema, envelope, sourceRecordId, outcome, deactivated);
    return outcome;
  }

  /**
   * Deleted-and-recreated is not a deletion: it is the same call wearing a new
   * source id. Left alone it produces an orphan holding the documents beside a
   * duplicate holding the data. So before sweeping, look for a call the
   * manifest calls `sent` that is the same ship, same port and near enough the
   * same ETA — and move the identity onto the row people have been working on.
   *
   * Only an unambiguous match adopts. Two candidates mean we do not know, and
   * guessing would merge two real calls.
   */
  private async tryAdopt(
    client: PoolClient,
    envelope: ManifestEnvelope,
    call: HeldCall,
    stated: Map<string, { sourceCallId: string; disposition: string }>,
  ): Promise<boolean> {
    if (!call.ship_id || !call.port_locode || !call.eta) return false;

    const candidates = await client.query<{
      id: string;
      source_call_id: string;
      eta: Date | null;
      etd: Date | null;
      voyage_number: string | null;
      cargo_description: string | null;
    }>(
      `SELECT id, source_call_id, eta, etd, voyage_number, cargo_description
         FROM port_call
        WHERE source = $1
          AND is_active
          AND id <> $2
          AND ship_id = $3
          AND port_locode = $4
          AND eta IS NOT NULL
          AND eta BETWEEN $5::timestamptz - ($6 || ' hours')::interval
                      AND $5::timestamptz + ($6 || ' hours')::interval`,
      [
        envelope.sourceSystem,
        call.id,
        call.ship_id,
        call.port_locode,
        call.eta,
        String(ADOPTION_ETA_TOLERANCE_HOURS),
      ],
    );
    // Only a call this same manifest vouches for is a recreation; anything
    // else is just another call that happens to look similar.
    const matches = candidates.rows.filter(
      (row) => stated.get(row.source_call_id)?.disposition === 'sent',
    );
    if (matches.length !== 1) return false;
    const replacement = matches[0]!;

    // Keep the old row — it holds the documents and the history — and give it
    // the new identity plus the newer spine values. The duplicate steps aside.
    await client.query(
      `UPDATE port_call
          SET source_call_id = $2,
              eta = $3, etd = $4,
              voyage_number = COALESCE($5, voyage_number),
              cargo_description = COALESCE($6, cargo_description),
              data = data || jsonb_build_object('sourceAdopted', $7::jsonb),
              updated = now()
        WHERE id = $1`,
      [
        call.id,
        replacement.source_call_id,
        replacement.eta,
        replacement.etd,
        replacement.voyage_number,
        replacement.cargo_description,
        JSON.stringify({
          at: envelope.occurredAt,
          previousSourceCallId: call.source_call_id,
          replacedPortCallId: replacement.id,
          manifestEventId: envelope.eventId,
        }),
      ],
    );
    await client.query(
      `UPDATE port_call SET is_active = false, updated = now() WHERE id = $1`,
      [replacement.id],
    );
    return true;
  }

  /** One audit event for the whole sweep, naming what it touched (invariant 5). */
  private async record(
    client: PoolClient,
    schema: string,
    envelope: ManifestEnvelope,
    sourceRecordId: string,
    outcome: ManifestOutcome,
    deactivated: string[],
  ): Promise<void> {
    await this.audit.content(
      {
        actorId: `ingest:${envelope.sourceSystem}`,
        // A sweep is about many calls, so it hangs on its own archived record.
        entityType: 'source_record',
        entityId: sourceRecordId,
        data: {
          action: outcome.action,
          sourceSystem: envelope.sourceSystem,
          eventId: envelope.eventId,
          sourceRecordId,
          payloadType: envelope.payloadType,
          scope: envelope.payload.scope,
          windowFrom: envelope.payload.windowFrom,
          windowTo: envelope.payload.windowTo,
          stated: envelope.payload.entries.length,
          covered: outcome.covered,
          withheld: outcome.withheld,
          deactivated: outcome.deactivated,
          retained: outcome.retained,
          adopted: outcome.adopted,
          // Named individually: a deactivation is the one irreversible-looking
          // thing here, and the trail has to say which calls it was.
          deactivatedPortCallIds: deactivated,
        },
        schema,
      },
      client,
    );
  }
}
