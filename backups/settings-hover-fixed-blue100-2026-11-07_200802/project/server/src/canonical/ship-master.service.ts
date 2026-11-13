/**
 * Ship master data ingest apply (docs/specs/0036): merges a validated
 * 'ship' envelope into the shared ship record (platform.ship since spec
 * 0067 — one hull, one record, every organisation). Runs inside the single
 * ingestion function's transaction (invariant 11) — this owns the domain
 * mutation + same-tx audit (invariant 5, self-contained per 0032/0033:
 * field diff AND the full envelope), written to the platform chain with the
 * pushing org on the event so other orgs' views can mask it.
 *
 * Sources contribute what they know: present fields are set, absent fields
 * stay, nulls never arrive (rejected at the envelope), and certificates merge
 * field by field rather than replacing the set (spec 0036 amendment) — the
 * issuer details an operator entered here outlive every push. Out-of-order
 * pushes are guarded per source via the data.ingest.<source> watermark.
 */

import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { IngestEnvelope, ShipPayload } from '../ingest/envelope.schema';
import {
  CERT_KEY,
  applyParticularsToData,
  certificatesFromData,
  mergeCertificates,
  diffParticulars,
  particularsFromData,
} from './ship-master-data';
import { laneFieldsFromEnvelope, withLane } from './ship-lanes';

export type ShipMasterAction = 'ship_updated' | 'ship_stale' | 'ship_created';

export interface ShipMasterOutcome {
  action: ShipMasterAction;
  shipId: string;
}

/** How a source-created ship names its origin (spec 0060). */
export function ingestActor(sourceSystem: string): string {
  return `ingest:${sourceSystem}`;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

@Injectable()
export class ShipMasterService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Register a ship from a source's own `ship` envelope (spec 0060). Only the
   * identity lands here — name and IMO, with `data.ingest.createdBy` saying
   * which push made the row — audited as `created` by the source, the same
   * event an admin creation writes. The caller then runs applyShip on the new
   * id so particulars and certificates arrive through the one merge path.
   */
  async createShip(
    client: PoolClient,
    orgSlug: string,
    envelope: IngestEnvelope & { payloadType: 'ship' },
    sourceRecordId: string,
  ): Promise<{ id: string; name: string | null }> {
    const actor = ingestActor(envelope.sourceSystem);
    const name = envelope.ship.name.trim();
    const data = {
      ingest: {
        createdBy: {
          sourceSystem: envelope.sourceSystem,
          eventId: envelope.eventId,
          sourceRecordId,
          at: new Date().toISOString(),
        },
      },
    };
    const mmsi = envelope.ship.mmsi ?? null;
    const callSign = envelope.ship.callSign ?? null;
    const inserted = await client.query<{ id: string; name: string | null }>(
      `INSERT INTO platform.ship
         (name, imo_number, mmsi, call_sign, data, author, author_org, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $6)
       RETURNING id, name`,
      [name, envelope.ship.imoNumber, mmsi, callSign, JSON.stringify(data), actor, orgSlug],
    );
    const row = inserted.rows[0]!;
    await this.audit.content(
      {
        actorId: actor,
        entityType: 'ship',
        entityId: row.id,
        data: {
          action: 'created',
          actorOrg: orgSlug,
          name,
          imoNumber: envelope.ship.imoNumber,
          mmsi,
          callSign,
          certificateCount: 0,
          sourceSystem: envelope.sourceSystem,
          eventId: envelope.eventId,
          sourceRecordId,
        },
      },
      client,
    );
    return row;
  }

  async applyShip(
    client: PoolClient,
    orgSlug: string,
    envelope: IngestEnvelope & { payloadType: 'ship' },
    shipId: string,
    sourceRecordId: string,
  ): Promise<ShipMasterOutcome> {
    const locked = await client.query<{
      data: Record<string, unknown>;
      name?: string | null;
      mmsi?: string | null;
      call_sign?: string | null;
    }>(`SELECT data, name, mmsi, call_sign FROM platform.ship WHERE id = $1 FOR UPDATE`, [shipId]);
    const data = asObject(locked.rows[0]?.data);
    const before = {
      name: locked.rows[0]?.name ?? null,
      mmsi: locked.rows[0]?.mmsi ?? null,
      callSign: locked.rows[0]?.call_sign ?? null,
    };

    const auditBase = {
      actorId: `ingest:${envelope.sourceSystem}`,
      entityType: 'ship',
      entityId: shipId,
    };
    const provenance = {
      actorOrg: orgSlug,
      sourceSystem: envelope.sourceSystem,
      eventId: envelope.eventId,
      sourceRecordId,
      payloadType: envelope.payloadType,
    };

    const watermark = asObject(asObject(data['ingest'])[envelope.sourceSystem]);
    const last = watermark['occurredAt'];
    if (
      typeof last === 'string' &&
      Date.parse(envelope.occurredAt) <= Date.parse(last)
    ) {
      await this.audit.content(
        {
          ...auditBase,
          data: { action: 'ship_stale', ...provenance, envelope },
        },
        client,
      );
      return { action: 'ship_stale', shipId };
    }

    // The source's lane first (spec 0061): everything it asserted. A push
    // never meets an override here any more — overrides are each org's own,
    // on its fleet row, applied when the row is read (spec 0068).
    let newData = withLane(data, envelope.sourceSystem, laneFieldsFromEnvelope(envelope), {
      receivedAt: new Date().toISOString(),
      occurredAt: envelope.occurredAt,
      eventId: envelope.eventId,
      sourceRecordId,
      org: orgSlug,
    });

    // Then the master values: a customer system outranks every platform
    // lane (spec 0068 tiers), so what it carries lands.
    const { certificates, ...particulars } = envelope.payload as ShipPayload;
    const applicable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(particulars)) {
      if (value !== undefined) applicable[key] = value;
    }
    newData = applyParticularsToData(newData, applicable as ShipPayload);
    if (certificates) {
      // Field-level merge, not replace (spec 0036 amendment): the issuer
      // details an operator entered here outlive every source push, and a
      // certificate the source does not carry is not a certificate it may
      // delete. Wholesale replacement stays an admin act (spec 0020).
      const stored = Array.isArray(data[CERT_KEY])
        ? (data[CERT_KEY] as Record<string, unknown>[])
        : [];
      newData = { ...newData, [CERT_KEY]: mergeCertificates(stored, certificates) };
    }
    newData['ingest'] = {
      ...asObject(data['ingest']),
      [envelope.sourceSystem]: {
        occurredAt: envelope.occurredAt,
        eventId: envelope.eventId,
        sourceRecordId,
      },
    };

    // Identity rides on the envelope's ship object (spec 0060 amendment):
    // present means set — an MMSI can be reassigned and the source is the
    // system of record — absent leaves the stored value alone. The name
    // follows the same rule since spec 0061.
    const name = envelope.ship.name.trim();
    const mmsi = envelope.ship.mmsi ?? null;
    const callSign = envelope.ship.callSign ?? null;
    await client.query(
      `UPDATE platform.ship
          SET data = $2::jsonb,
              mmsi = COALESCE($3, mmsi),
              call_sign = COALESCE($4, call_sign),
              name = COALESCE($5, name),
              updated = now()
        WHERE id = $1`,
      [shipId, JSON.stringify(newData), mmsi, callSign, name],
    );

    const changes: Record<string, unknown> = diffParticulars(
      particularsFromData(data),
      particularsFromData(newData),
    );
    if (name !== null && name !== before.name) {
      changes['name'] = { from: before.name, to: name };
    }
    if (mmsi !== null && mmsi !== before.mmsi) {
      changes['mmsi'] = { from: before.mmsi, to: mmsi };
    }
    if (callSign !== null && callSign !== before.callSign) {
      changes['callSign'] = { from: before.callSign, to: callSign };
    }
    const certsBefore = certificatesFromData(data);
    const certsAfter = certificatesFromData(newData);
    if (JSON.stringify(certsBefore) !== JSON.stringify(certsAfter)) {
      changes['certificates'] = {
        from: certsBefore.length,
        to: certsAfter.length,
      };
    }

    await this.audit.content(
      {
        ...auditBase,
        data: {
          action: 'ship_updated',
          ...provenance,
          changes,
          envelope,
        },
      },
      client,
    );
    return { action: 'ship_updated', shipId };
  }

  /**
   * A push puts the ship in the pushing org's fleet (spec 0068): any
   * envelope kind, once. Runs inside the ingest transaction on the org
   * schema (`fleet_ship` unqualified) and audits `fleet_added` on the
   * org's own chain — the org's data, the org's names. Returns whether a
   * row was added.
   */
  async ensureFleetMembership(
    client: PoolClient,
    schema: string,
    envelope: IngestEnvelope,
    shipId: string,
    sourceRecordId: string,
  ): Promise<boolean> {
    const actor = ingestActor(envelope.sourceSystem);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO fleet_ship (ship_id, author, source)
       SELECT $1, $2, $2
        WHERE NOT EXISTS (SELECT 1 FROM fleet_ship WHERE ship_id = $1 AND is_active)
       RETURNING id`,
      [shipId, actor],
    );
    const row = inserted.rows[0];
    if (!row) return false;
    await this.audit.content(
      {
        actorId: actor,
        entityType: 'fleet_ship',
        entityId: row.id,
        schema,
        data: {
          action: 'fleet_added',
          shipId,
          sourceSystem: envelope.sourceSystem,
          eventId: envelope.eventId,
          sourceRecordId,
        },
      },
      client,
    );
    return true;
  }
}
