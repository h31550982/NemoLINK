/**
 * The single ingestion function (invariant 11, docs/specs/0026): every
 * inbound envelope — whatever the transport — passes through here. One org
 * transaction, all-or-nothing: advisory lock per ship, dedupe on
 * (sourceSystem, eventId), verbatim source_record archive, then the
 * canonical apply + same-tx audit. On any failure nothing is stored and the
 * caller retries freely; the Phase-3 exception queue adds store-and-flag
 * handling for unmatchable data later.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';
import { ManifestService, ManifestAction } from '../canonical/manifest.service';
import { PortCallService, IngestAction } from '../canonical/port-call.service';
import {
  ShipMasterAction,
  ShipMasterOutcome,
  ShipMasterService,
} from '../canonical/ship-master.service';
import { TenantDb } from '../tenancy/tenant-db';
import { envelopeSchema } from './envelope.schema';
import { IngestContext } from './ingest-credential.service';

export interface IngestResult {
  status:
    | 'created'
    | 'updated'
    | 'suggested'
    | 'stale'
    | 'duplicate'
    | 'unmatched'
    | 'ignored_cancelled'
    /** A manifest was applied (spec 0055) — the sweep counts ride in `manifest`. */
    | 'swept'
    /** A manifest that would remove too much; nothing was changed. */
    | 'held';
  portCallId?: string;
  /** The ship a 'ship' payload was applied to (spec 0036). */
  shipId?: string;
  sourceRecordId?: string;
  /** What a manifest sweep did (spec 0055). */
  manifest?: {
    covered: number;
    withheld: number;
    deactivated: number;
    retained: number;
    adopted: number;
  };
  /** Non-fatal observations, e.g. ship_name_mismatch (spec 0034). */
  warnings?: string[];
}

const ACTION_STATUS: Record<
  IngestAction | ShipMasterAction | ManifestAction,
  IngestResult['status']
> = {
  manifest_applied: 'swept',
  manifest_held: 'held',
  created: 'created',
  plan_updated: 'updated',
  plan_stale: 'stale',
  plan_ignored_cancelled: 'ignored_cancelled',
  log_stale: 'stale',
  arrival_suggested: 'suggested',
  departure_suggested: 'suggested',
  log_unmatched: 'unmatched',
  ship_updated: 'updated',
  ship_stale: 'stale',
  ship_created: 'created',
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof DatabaseError && error.code === '23505';
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly portCalls: PortCallService,
    private readonly shipMaster: ShipMasterService,
    private readonly manifests: ManifestService,
  ) {}

  async ingest(ctx: IngestContext, body: unknown): Promise<IngestResult> {
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success) {
      // Field pointers only — submitted values are never echoed (invariant 3)
      throw new BadRequestException({
        message: 'Invalid ingest envelope',
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const envelope = parsed.data;
    if (envelope.sourceSystem !== ctx.sourceSystem) {
      // One system must never write another lane's provenance (spec 0026)
      throw new ForbiddenException(
        `This credential belongs to source system '${ctx.sourceSystem}'`,
      );
    }

    const schema = await this.tenantDb.schemaFor(ctx.orgSlug);
    try {
      const result = await this.tenantDb.withOrg(ctx.orgSlug, async (client) => {
        if (envelope.payloadType === 'manifest') {
          // A sweep is about many calls of one source, not one ship, so it
          // serializes on the source system instead: two overlapping manifests
          // must not race each other's decisions about the same window.
          await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
            `ingest:${schema}:manifest:${envelope.sourceSystem}`,
          ]);
          const seen = await this.findDuplicate(client, envelope);
          if (seen) {
            return { status: 'duplicate', sourceRecordId: seen } as IngestResult;
          }
          const sourceRecordId = await this.archive(client, envelope, body);
          const swept = await this.manifests.apply(
            client,
            schema,
            envelope,
            sourceRecordId,
          );
          await this.recordOutcome(client, sourceRecordId, swept.action);
          const { action: _action, warnings: sweptWarnings, ...counts } = swept;
          return {
            status: ACTION_STATUS[swept.action],
            sourceRecordId,
            manifest: counts,
            ...(sweptWarnings && sweptWarnings.length > 0
              ? { warnings: sweptWarnings }
              : {}),
          } as IngestResult;
        }

        // Serialize per ship: racing pushes must not create duplicate calls
        // or duplicate ships — platform-wide, since the ship record is
        // (spec 0067).
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `ingest:ship:${envelope.ship.imoNumber}`,
        ]);

        const seen = await this.findDuplicate(client, envelope);
        if (seen) {
          return { status: 'duplicate', sourceRecordId: seen } as IngestResult;
        }

        // Ships are platform data (spec 0067): the IMO is looked up across
        // every organisation, and a hull another org registered is used —
        // never created a second time.
        const ship = await client.query<{ id: string; name: string | null }>(
          `SELECT id, name FROM platform.ship WHERE imo_number = $1 AND is_active`,
          [envelope.ship.imoNumber],
        );
        let shipRow = ship.rows[0];
        // Ships are admin-maintained master data, with one exception (spec
        // 0060): a source allowed to register its own fleet may create a
        // ship from its `ship` envelope — the master-data statement — never
        // from a plan or a log event, which carry only an IMO and a name.
        const create =
          !shipRow && envelope.payloadType === 'ship' && ctx.mayCreateShips;
        if (!shipRow && !create) {
          throw new UnprocessableEntityException({
            error: 'unknown_ship',
            imoNumber: envelope.ship.imoNumber,
            message:
              `No active ship with IMO ${envelope.ship.imoNumber} in NEMOLink — ` +
              (envelope.payloadType === 'ship'
                ? 'add the ship in the admin area, or allow this credential to create ships'
                : 'add the ship in the admin area first'),
          });
        }
        if (create) {
          // A retired ship is an admin decision; the push does not undo it.
          const retired = await client.query<{ id: string }>(
            `SELECT id FROM platform.ship WHERE imo_number = $1 AND NOT is_active LIMIT 1`,
            [envelope.ship.imoNumber],
          );
          if (retired.rows[0]) {
            throw new UnprocessableEntityException({
              error: 'inactive_ship',
              imoNumber: envelope.ship.imoNumber,
              message: `The ship with IMO ${envelope.ship.imoNumber} is inactive in NEMOLink — reactivate it in the admin area first`,
            });
          }
        }
        // IMO is the hard identity; a drifting name is worth flagging but
        // never worth bouncing a voyage over (spec 0034 AC 6). A ship we are
        // about to create takes the envelope's name, so nothing to compare.
        const registered = shipRow?.name?.trim().toLowerCase();
        const nameWarnings =
          registered && registered !== envelope.ship.name.trim().toLowerCase()
            ? ['ship_name_mismatch']
            : [];

        const sourceRecordId = await this.archive(client, envelope, body);

        if (create && envelope.payloadType === 'ship') {
          shipRow = await this.shipMaster.createShip(
            client,
            ctx.orgSlug,
            envelope,
            sourceRecordId,
          );
        }
        const shipId = shipRow!.id;
        // The pushing org's fleet (spec 0068): any envelope for the ship
        // puts it on the org's shortlist, once.
        await this.shipMaster.ensureFleetMembership(
          client,
          schema,
          envelope,
          shipId,
          sourceRecordId,
        );

        const outcome =
          envelope.payloadType === 'ship'
            ? await this.shipMaster
                .applyShip(client, ctx.orgSlug, envelope, shipId, sourceRecordId)
                .then(
                  (applied): ShipMasterOutcome =>
                    // The apply on a brand-new row is the tail of the creation,
                    // not an update; archive and caller both learn ship_created.
                    create ? { ...applied, action: 'ship_created' } : applied,
                )
            : await this.portCalls.apply(
                client,
                schema,
                envelope,
                shipId,
                sourceRecordId,
              );
        await this.recordOutcome(client, sourceRecordId, outcome.action);
        // Whatever the apply step observed (a substituted port code, spec
        // 0056) travels with the ship-name check as one list.
        const warnings = [
          ...nameWarnings,
          ...('warnings' in outcome && outcome.warnings ? outcome.warnings : []),
        ];
        return {
          status: ACTION_STATUS[outcome.action],
          ...('portCallId' in outcome && outcome.portCallId
            ? { portCallId: outcome.portCallId }
            : {}),
          ...('shipId' in outcome ? { shipId: outcome.shipId } : {}),
          sourceRecordId,
          ...(warnings.length > 0 ? { warnings } : {}),
        } as IngestResult;
      });
      this.logger.log(
        `ingest ${ctx.sourceSystem}/${envelope.payloadType} -> ${result.status}`,
      );
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Dedupe race: a concurrent request archived this event first — the
        // transaction rolled back, the earlier one stands. Same idempotent
        // answer as the in-tx check.
        return { status: 'duplicate' };
      }
      throw error;
    }
  }

  /** The dedupe key is (sourceSystem, eventId) — a re-send is idempotent. */
  private async findDuplicate(
    client: PoolClient,
    envelope: { sourceSystem: string; eventId: string },
  ): Promise<string | undefined> {
    const dup = await client.query<{ id: string }>(
      `SELECT id FROM source_record WHERE source_system = $1 AND event_id = $2`,
      [envelope.sourceSystem, envelope.eventId],
    );
    return dup.rows[0]?.id;
  }

  /** Verbatim, before anything is interpreted (spec 0026). */
  private async archive(
    client: PoolClient,
    envelope: { sourceSystem: string; eventId: string },
    body: unknown,
  ): Promise<string> {
    const record = await client.query<{ id: string }>(
      `INSERT INTO source_record (source_system, channel, event_id, payload)
       VALUES ($1, 'api', $2, $3::jsonb)
       RETURNING id`,
      [envelope.sourceSystem, envelope.eventId, JSON.stringify(body)],
    );
    return record.rows[0]!.id;
  }

  /**
   * The archive remembers what ingestion did with each event — unmatched ones
   * stay queryable for operator triage (spec 0034), and a held manifest is
   * findable by an admin the same way (spec 0055).
   */
  private async recordOutcome(
    client: PoolClient,
    sourceRecordId: string,
    action: string,
  ): Promise<void> {
    await client.query(`UPDATE source_record SET outcome = $2 WHERE id = $1`, [
      sourceRecordId,
      action,
    ]);
  }
}
