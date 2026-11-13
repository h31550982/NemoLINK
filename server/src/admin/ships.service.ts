/**
 * Ships as an organisation sees them (docs/specs/0017, 0067, 0068): the
 * MASTER LIST is `platform.ship` — one record per hull, an external source
 * fed by customer systems, NEMO's ship database and Digitraffic — and the
 * org's FLEET is its own `fleet_ship` shortlist, carrying the org's
 * overrides. A row here is one ship as one org sees it: the master values
 * in the External column, the org's overrides on top, To NEMO = override
 * ?? master, and the shared "In NEMO" snapshot.
 *
 * Writes run inside the org transaction (TenantDb.withOrg; invariant 1).
 * Fleet writes audit on the org's own chain (its data, its names); master
 * list writes audit on the platform chain with the actor's org, masked for
 * other orgs (0067). Never a delete: leaving the fleet deactivates the row.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseError, PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import { SessionUser } from '../auth/session.service';
import {
  CERT_KEY,
  ShipCertificateRow,
  ShipParticulars,
  applyParticularsToData,
  certToMig,
  diffParticulars,
  particularsFromData,
} from '../canonical/ship-master-data';
import {
  ExternalValue,
  FieldOverride,
  LaneSnapshot,
  OVERRIDES_KEY,
  PARTICULARS_KEY_SET,
  certExpiryKey,
  externalsOf,
  isCustomerLane,
  isIdentityKey,
  lanesOf,
  lastIngestOf,
  latestExternal,
  parseCertExpiryKey,
  sameValue,
  withOverride,
} from '../canonical/ship-lanes';
import { NemoIssue } from '../canonical/nemo-ui-rules';
import { resolveShip } from '../canonical/ship-resolve';
import {
  NemoSnapshot,
  nemoSnapshotOf,
  NSD_REFUSED_WORDS,
  nsdReadIntoData,
  shipIssuesOf,
} from '../canonical/ship-nemo';
import { shipFieldIds, ShipHomeFormality } from '../canonical/ship-formalities';
import { NemoApiError, NemoClientService, NemoShipRecord } from '../nemo-client/nemo-client.service';
import { TenantDb } from '../tenancy/tenant-db';
import { ShipCreate, ShipUpdate } from './ship.schema';

/** The NEMO ID column (spec 0070): the same map for every row. */
const SHIP_FIELD_IDS = shipFieldIds();

export type { ShipCertificateRow } from '../canonical/ship-master-data';
export type { ExternalValue, FieldOverride, LaneSnapshot } from '../canonical/ship-lanes';
export type { NemoSnapshot } from '../canonical/ship-nemo';
export type { NemoIssue } from '../canonical/nemo-ui-rules';

/** The words an org sees for anything another org did (spec 0067 §3). */
export const OTHER_ORG = 'Other organisation';
/** Plain words for the platform lanes (spec 0068). */
const LANE_WORDS: Readonly<Record<string, string>> = {
  nsd: 'NEMO ship database',
  digitraffic: 'Digitraffic',
};
/** A snapshot older than this is read again when a ship joins a fleet. */
const SNAPSHOT_FRESH_MS = 24 * 60 * 60 * 1000;

/** A source lane as the viewer may see it. */
export interface ShipLaneView extends LaneSnapshot {
  /** The source system for the viewer's own org, a platform lane's words, or "Other organisation". */
  by: string;
}

/** The External column, per field (spec 0068): the master list's resolved value and where it came from. */
export interface ExternalCell {
  value: unknown;
  /** Words: the source system (own), "Other organisation", "NEMO ship database", "Digitraffic", or "master list". */
  source: string;
  occurredAt: string;
  receivedAt: string;
}

export interface FleetFacts {
  id: string;
  since: string;
  /** Who put it in the fleet: a user, or the source system that pushed it. */
  addedBy: string;
}

export interface ShipRow {
  /** The master list id (platform.ship). Every route addresses a ship by it. */
  id: string;
  /** To NEMO: the org's override, else the master value. */
  name: string | null;
  imoNumber: string | null;
  mmsi: string | null;
  callSign: string | null;
  /** Platform-wide activation (platform admins only). */
  isActive: boolean;
  created: string;
  updated: string;
  /** Who made the master row: 'admin-ui', 'ingest:<source>', or 'digitraffic' (spec 0068). */
  source: string | null;
  /** Who registered it, as the viewer may see it: a user, a source system, "Digitraffic", or "Other organisation". */
  addedBy: string;
  /** Registered by the viewer's own org. */
  own: boolean;
  /** This org's fleet row; null when the ship is not in the fleet (platform views). */
  fleet: FleetFacts | null;
  /** To NEMO certificates: the master set with the org's expiry overrides applied. */
  certificates: ShipCertificateRow[];
  /** To NEMO particulars (spec 0036): master values with the org's overrides on top. */
  particulars: ShipParticulars;
  /** The trail: what each source asserted (spec 0061), masked per org (0067). */
  lanes: Record<string, ShipLaneView>;
  /** The External column per field key (spec 0068). */
  external: Record<string, ExternalCell>;
  /** The org's overrides, per field key (spec 0061/0068), rule-6 flags computed at read. */
  overrides: Record<string, FieldOverride>;
  /** The last push by a customer system, any org. */
  lastIngest: { source: string; receivedAt: string } | null;
  /** What NEMO's ship database held when we last read it (spec 0064); null before the first read. */
  nemo: NemoSnapshot | null;
  /** What NEMO's own screens show for the ship (spec 0065), and whether it exists there (0067). */
  nemoIssues: NemoIssue[];
  /** The NEMO ID column (spec 0070): per field key, the report that carries it and its element id. */
  nemoIds: Record<string, { formality: ShipHomeFormality; de: string; sent: boolean }>;
}

/** A master-list hit for the org's search (spec 0068 §"What each org sees"). */
export interface ShipSearchHit {
  id: string;
  name: string | null;
  imoNumber: string | null;
  mmsi: string | null;
  callSign: string | null;
  inFleet: boolean;
  /** 'yes' = NSD knows it, 'no' = looked and absent, 'unread' = never read. */
  inNemo: 'yes' | 'no' | 'unread';
}

/** The platform page's view of a master ship (spec 0068): unmasked, with the fleets it is in. */
export interface PlatformShipRow extends ShipRow {
  fleets: string[];
}

const SHIP_SQL = `s.id, s.name, s.imo_number, s.mmsi, s.call_sign, s.is_active, s.created,
  s.updated, s.author, s.author_org, s.source, s.data`;
const FLEET_SQL = `f.id AS fleet_id, f.created AS fleet_since, f.author AS fleet_author,
  f.source AS fleet_source, f.data AS fleet_data`;

interface DbShip {
  id: string;
  name: string | null;
  imo_number: string | null;
  mmsi: string | null;
  call_sign: string | null;
  is_active: boolean;
  created: Date;
  updated: Date;
  author: string | null;
  author_org: string | null;
  source: string | null;
  data: Record<string, unknown>;
}

interface DbFleet {
  fleet_id: string | null;
  fleet_since: Date | null;
  fleet_author: string | null;
  fleet_source: string | null;
  fleet_data: Record<string, unknown> | null;
}

type DbRow = DbShip & Partial<DbFleet>;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function whoWords(source: string | null, author: string | null): string {
  if (source?.startsWith('ingest:')) return source.slice('ingest:'.length);
  if (source === 'digitraffic') return 'Digitraffic';
  return author ?? 'an administrator';
}

/**
 * One ship as one viewer sees it (specs 0067 §3, 0068): master values plus
 * the org's own overrides; names only inside the org that made them — another
 * org's registration or push reads "Other organisation"; platform lanes
 * read in plain words; a platform admin sees everyone, with the org.
 */
function toRow(r: DbRow, viewer: SessionUser, nemoUiUrl: string | null): ShipRow {
  const master = r.data ?? {};
  const unmasked = viewer.platformAdmin === true;
  const sees = (org: string | null | undefined): boolean =>
    unmasked || (org ?? r.author_org) === viewer.orgSlug;
  const who = whoWords(r.source, r.author);
  const addedBy =
    r.source === 'digitraffic'
      ? who
      : sees(r.author_org)
        ? unmasked && r.author_org
          ? `${who} (${r.author_org})`
          : who
        : OTHER_ORG;
  const laneWords = (source: string, org: string | undefined): string => {
    if (!isCustomerLane(source)) return LANE_WORDS[source] ?? source;
    return sees(org) ? source : OTHER_ORG;
  };

  const lanes: Record<string, ShipLaneView> = {};
  for (const [source, lane] of Object.entries(lanesOf(master))) {
    const by = laneWords(source, lane.org);
    if (by === OTHER_ORG) {
      const { org: _org, ...rest } = lane;
      lanes[source] = { ...rest, by };
    } else {
      lanes[source] = { ...lane, by };
    }
  }
  const external: Record<string, ExternalCell> = {};
  for (const [key, cell] of Object.entries(externalsOf(master))) {
    external[key] = {
      value: cell.value,
      source: laneWords(cell.source, cell.org),
      occurredAt: cell.occurredAt,
      receivedAt: cell.receivedAt,
    };
  }
  // Master values no lane explains (typed in at creation) are external too:
  // the master list is the source, and its registrar is who it says.
  const masterCreated = r.created.toISOString();
  const masterValues: Record<string, unknown> = {
    name: r.name,
    imoNumber: r.imo_number,
    mmsi: r.mmsi,
    callSign: r.call_sign,
    ...particularsFromData(master),
  };
  for (const [key, value] of Object.entries(masterValues)) {
    if (value === null || value === undefined || key in external) continue;
    external[key] = { value, source: 'master list', occurredAt: masterCreated, receivedAt: masterCreated };
  }
  // A certificate's own expiry is not External: it is the certificate as
  // someone entered it, most often this organisation (spec 0086 amendment).
  // Only a source's date (NSD, a customer feed) is.

  // The org's overrides on the master — To NEMO = override ?? master, one
  // resolver shared with the port-call checklists (spec 0075).
  const resolved = resolveShip(master, r.fleet_data, {
    name: r.name,
    mmsi: r.mmsi,
    callSign: r.call_sign,
  });
  const overrides: Record<string, FieldOverride> = {};
  for (const [key, o] of Object.entries(resolved.overrides)) {
    const { org: _org, ...rest } = o;
    overrides[key] = rest;
  }
  const { particulars, certificates } = resolved;

  const last = lastIngestOf(master);
  const snapshot = nemoSnapshotOf(master);
  return {
    id: r.id,
    name: resolved.name,
    imoNumber: r.imo_number,
    mmsi: resolved.mmsi,
    callSign: resolved.callSign,
    isActive: r.is_active,
    created: masterCreated,
    updated: r.updated.toISOString(),
    source: r.source ?? null,
    addedBy,
    own: r.author_org !== null && r.author_org === viewer.orgSlug,
    fleet:
      r.fleet_id && r.fleet_since
        ? {
            id: r.fleet_id,
            since: r.fleet_since.toISOString(),
            addedBy: whoWords(r.fleet_source ?? null, r.fleet_author ?? null),
          }
        : null,
    certificates,
    particulars,
    lanes,
    external,
    overrides,
    lastIngest: last ? { source: lanes[last.source]?.by ?? last.source, receivedAt: last.receivedAt } : null,
    nemo: snapshot,
    nemoIssues: shipIssuesOf(snapshot, Date.now(), nemoUiUrl),
    nemoIds: SHIP_FIELD_IDS,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof DatabaseError && error.code === '23505';
}

const DUPLICATE_IMO =
  'A ship with this IMO number is already on the master list — search for it and add it to your fleet';

const SCALAR_FIELDS = ['name', 'imoNumber', 'mmsi', 'callSign'] as const;

/** Field-level old→new diff for audit events (docs/specs/0032): only what changed. */
function diffShip(before: ShipRow, after: ShipRow): Record<string, unknown> {
  const changes: Record<string, unknown> = {
    ...diffParticulars(before.particulars, after.particulars),
  };
  for (const key of SCALAR_FIELDS) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  if (JSON.stringify(before.certificates) !== JSON.stringify(after.certificates)) {
    changes['certificates'] = {
      from: before.certificates.length,
      to: after.certificates.length,
    };
  }
  return changes;
}

const FLEET_JOIN = `FROM platform.ship s
   LEFT JOIN fleet_ship f ON f.ship_id = s.id AND f.is_active`;
/** For locked writes: Postgres cannot lock the nullable side of an outer join, and the fleet row must exist anyway. */
const FLEET_LOCK_JOIN = `FROM platform.ship s
   JOIN fleet_ship f ON f.ship_id = s.id AND f.is_active`;

@Injectable()
export class ShipsService {
  private readonly logger = new Logger(ShipsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly nemo: NemoClientService,
  ) {}

  /** The NEMO UI to send an operator to (spec 0067 §5); null on the mock target. */
  private get nemoUiUrl(): string | null {
    return this.nemo.uiUrl ?? null;
  }

  // ---- reads ---------------------------------------------------------------

  /** The org's fleet (spec 0068): its shortlist, each ship as the org sees it. */
  async list(admin: SessionUser): Promise<ShipRow[]> {
    return this.tenantDb.withOrg(admin.orgSlug, async (client) => {
      const result = await client.query(
        `SELECT ${SHIP_SQL}, ${FLEET_SQL}
           FROM fleet_ship f
           JOIN platform.ship s ON s.id = f.ship_id
          WHERE f.is_active
          ORDER BY s.is_active DESC, s.name NULLS LAST, s.created DESC`,
      );
      return result.rows.map((r: DbRow) => toRow(r, admin, this.nemoUiUrl));
    });
  }

  /**
   * Search the master list by name (anywhere in it) or IMO (from the start)
   * — the org's way into the shared list (spec 0068). Two characters or
   * more, twenty hits, active ships only.
   */
  async search(admin: SessionUser, q: string): Promise<ShipSearchHit[]> {
    const query = q.trim();
    if (query.length < 2) return [];
    const pattern = '%' + query.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const imoPrefix = /^\d+$/.test(query) ? query + '%' : null;
    return this.tenantDb.withOrg(admin.orgSlug, async (client) => {
      const result = await client.query(
        `SELECT s.id, s.name, s.imo_number, s.mmsi, s.call_sign,
                s.data->'nemo' AS nemo,
                EXISTS (SELECT 1 FROM fleet_ship f
                         WHERE f.ship_id = s.id AND f.is_active) AS in_fleet
           FROM platform.ship s
          WHERE s.is_active
            AND (s.name ILIKE $1 OR ($2::text IS NOT NULL AND s.imo_number LIKE $2))
          ORDER BY s.name NULLS LAST
          LIMIT 20`,
        [pattern, imoPrefix],
      );
      return result.rows.map((r) => {
        const nemo = asObject(r.nemo);
        return {
          id: r.id,
          name: r.name,
          imoNumber: r.imo_number,
          mmsi: r.mmsi,
          callSign: r.call_sign,
          inFleet: r.in_fleet === true,
          inNemo:
            typeof nemo['at'] !== 'string' ? 'unread' : typeof nemo['shipId'] === 'string' ? 'yes' : 'no',
        };
      });
    });
  }

  /** One ship as the org sees it, in the fleet or not. */
  /** One ship as the viewer sees it — the To NEMO view the send reads (spec 0070). */
  async get(viewer: SessionUser, shipId: string): Promise<ShipRow> {
    return this.tenantDb.withOrg(viewer.orgSlug, (client) => this.readOne(client, viewer, shipId));
  }

  private async readOne(client: PoolClient, viewer: SessionUser, shipId: string): Promise<ShipRow> {
    const result = await client.query(
      `SELECT ${SHIP_SQL}, ${FLEET_SQL} ${FLEET_JOIN} WHERE s.id = $1`,
      [shipId],
    );
    if (result.rowCount === 0) throw new NotFoundException();
    return toRow(result.rows[0], viewer, this.nemoUiUrl);
  }

  // ---- the fleet -----------------------------------------------------------

  /**
   * Put a master-list ship in the org's fleet (spec 0068). Idempotent: an
   * active row is left alone, a left-fleet row comes back with its overrides.
   * Then, best effort and outside the transaction, the "In NEMO" snapshot is
   * read when missing or older than a day, so the ledger is filled the
   * moment the ship appears.
   */
  async addToFleet(admin: SessionUser, shipId: string): Promise<ShipRow> {
    const schema = await this.tenantDb.schemaFor(admin.orgSlug);
    const snapshotAt = await this.tenantDb.withOrg(admin.orgSlug, async (client) => {
      const ship = await client.query<{ nemo_at: string | null }>(
        `SELECT s.data->'nemo'->>'at' AS nemo_at FROM platform.ship s
          WHERE s.id = $1 AND s.is_active`,
        [shipId],
      );
      if (ship.rowCount === 0) throw new NotFoundException('No such ship on the master list');
      const existing = await client.query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM fleet_ship WHERE ship_id = $1
          ORDER BY is_active DESC, created DESC LIMIT 1 FOR UPDATE`,
        [shipId],
      );
      const row = existing.rows[0];
      if (row?.is_active) return ship.rows[0]!.nemo_at;
      let fleetId: string;
      if (row) {
        await client.query(
          `UPDATE fleet_ship SET is_active = true, author = $2, source = 'admin-ui', updated = now()
            WHERE id = $1`,
          [row.id, admin.username],
        );
        fleetId = row.id;
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO fleet_ship (ship_id, author, source) VALUES ($1, $2, 'admin-ui') RETURNING id`,
          [shipId, admin.username],
        );
        fleetId = inserted.rows[0]!.id;
      }
      await this.audit.content(
        {
          actorId: admin.username,
          entityType: 'fleet_ship',
          entityId: fleetId,
          data: { action: 'fleet_added', shipId, ...(row ? { rejoined: true } : {}) },
          schema,
        },
        client,
      );
      return ship.rows[0]!.nemo_at;
    });
    if (!snapshotAt || Date.now() - Date.parse(snapshotAt) > SNAPSHOT_FRESH_MS) {
      await this.prefillFromNemo(admin, shipId);
    }
    return this.tenantDb.withOrg(admin.orgSlug, (client) => this.readOne(client, admin, shipId));
  }

  /** Take a ship out of the org's fleet (spec 0068): the row is deactivated, its overrides kept. */
  async removeFromFleet(admin: SessionUser, shipId: string): Promise<void> {
    const schema = await this.tenantDb.schemaFor(admin.orgSlug);
    await this.tenantDb.withOrg(admin.orgSlug, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE fleet_ship SET is_active = false, updated = now()
          WHERE ship_id = $1 AND is_active RETURNING id`,
        [shipId],
      );
      if (result.rowCount === 0) throw new NotFoundException('The ship is not in your fleet');
      await this.audit.content(
        {
          actorId: admin.username,
          entityType: 'fleet_ship',
          entityId: result.rows[0]!.id,
          data: { action: 'fleet_removed', shipId },
          schema,
        },
        client,
      );
    });
  }

  /** The snapshot read that add-to-fleet triggers: never a failure of the add. */
  private async prefillFromNemo(admin: SessionUser, shipId: string): Promise<void> {
    try {
      await this.refreshFromNemo(admin, shipId);
    } catch (error) {
      this.logger.warn(
        `In NEMO not prefilled for ship ${shipId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---- the master list -----------------------------------------------------

  /**
   * Create a master-list ship and put it in the org's fleet (spec 0068): the
   * fallback when the search finds nothing. Identity, particulars and
   * certificates typed here land on the master row (the org is its
   * registrar — `author_org`), audited on the platform chain; the fleet row
   * audits on the org chain.
   */
  async create(admin: SessionUser, input: ShipCreate): Promise<ShipRow> {
    const schema = await this.tenantDb.schemaFor(admin.orgSlug);
    let created: string;
    try {
      created = await this.tenantDb.withOrg(admin.orgSlug, async (client) => {
        let data: Record<string, unknown> = input.certificates
          ? { [CERT_KEY]: input.certificates.map(certToMig) }
          : {};
        if (input.particulars) {
          data = applyParticularsToData(data, input.particulars);
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO platform.ship
             (name, imo_number, mmsi, call_sign, data, author, author_org, source)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'admin-ui')
           RETURNING id`,
          [
            input.name,
            input.imoNumber ?? null,
            input.mmsi ?? null,
            input.callSign ?? null,
            JSON.stringify(data),
            admin.username,
            admin.orgSlug,
          ],
        );
        const shipId = result.rows[0]!.id;
        await this.audit.content(
          {
            actorId: admin.username,
            entityType: 'ship',
            entityId: shipId,
            data: {
              action: 'created',
              actorOrg: admin.orgSlug,
              name: input.name,
              imoNumber: input.imoNumber ?? null,
              mmsi: input.mmsi ?? null,
              callSign: input.callSign ?? null,
              certificateCount: input.certificates?.length ?? 0,
              ...(input.particulars ? { particulars: particularsFromData(data) } : {}),
            },
          },
          client,
        );
        const fleet = await client.query<{ id: string }>(
          `INSERT INTO fleet_ship (ship_id, author, source) VALUES ($1, $2, 'admin-ui') RETURNING id`,
          [shipId, admin.username],
        );
        await this.audit.content(
          {
            actorId: admin.username,
            entityType: 'fleet_ship',
            entityId: fleet.rows[0]!.id,
            data: { action: 'fleet_added', shipId, created: true },
            schema,
          },
          client,
        );
        return shipId;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(DUPLICATE_IMO);
      }
      throw error;
    }
    // A new hull may already be in NEMO (somebody else's VID): say so at once.
    await this.prefillFromNemo(admin, created);
    return this.tenantDb.withOrg(admin.orgSlug, (client) => this.readOne(client, admin, created));
  }

  /**
   * An org's edit of a ship in its fleet (specs 0061, 0068). A field some
   * source asserts becomes the org's OVERRIDE (on its fleet row) when the
   * edit differs from the master value, and stops being one when it agrees;
   * a field no source ever asserted edits the master row itself — shared
   * data, audited on the platform chain with the org, masked for others.
   * Certificates are shared master data: the set replaces wholesale (0020),
   * an expiry that differs from a source's date becomes an override. The
   * IMO number is the hull's identity: only its registrar changes it.
   */
  async update(
    admin: SessionUser,
    shipId: string,
    input: ShipUpdate,
  ): Promise<ShipRow> {
    const schema = await this.tenantDb.schemaFor(admin.orgSlug);
    try {
      return await this.tenantDb.withOrg(admin.orgSlug, async (client) => {
        // Both rows locked: the diff needs the old view, FOR UPDATE
        // serializes concurrent edits (docs/specs/0032).
        const before = await client.query(
          `SELECT ${SHIP_SQL}, ${FLEET_SQL} ${FLEET_LOCK_JOIN} WHERE s.id = $1 FOR UPDATE OF s, f`,
          [shipId],
        );
        if (before.rowCount === 0) throw new NotFoundException('The ship is not in your fleet');
        const locked: DbRow = before.rows[0];
        if (!locked.fleet_id) throw new NotFoundException('The ship is not in your fleet');
        const oldRow = toRow(locked, admin, this.nemoUiUrl);
        const masterData: Record<string, unknown> = locked.data ?? {};
        let newMaster = masterData;
        let fleetData = asObject(locked.fleet_data);

        if ('imoNumber' in input && input.imoNumber !== locked.imo_number && !oldRow.own) {
          throw new BadRequestException(
            "The IMO number is the ship's identity on the master list — only the organisation that registered the ship changes it",
          );
        }
        if ('certificates' in input) {
          // The set replaces wholesale (0020) on the shared row — but an
          // expiry a source asserts keeps the SOURCE's date there; the typed
          // date becomes the org's override below (rule 6 is read-time).
          const set = (input.certificates ?? []).map(certToMig);
          for (const cert of set) {
            const key = certExpiryKey(
              String(cert['ram:TypeCode']),
              typeof cert['ram:ID'] === 'string' ? cert['ram:ID'] : null,
            );
            const external = latestExternal(masterData, key);
            if (!external) continue;
            if (typeof external.value === 'string') cert['ram:ExpiryDate'] = external.value;
            else delete cert['ram:ExpiryDate'];
          }
          newMaster = { ...newMaster, [CERT_KEY]: set };
        }

        // Override or master edit, per field (spec 0061 rule, per fleet since 0068).
        const now = new Date().toISOString();
        const columns: Record<'name' | 'mmsi' | 'call_sign', string | null | undefined> = {
          name: undefined,
          mmsi: undefined,
          call_sign: undefined,
        };
        const masterParticulars: Record<string, unknown> = {};
        // What the External column shows for a key: a source's value, or the
        // master row's own. An edit of either is the org's override; only an
        // empty master field is filled in place (spec 0086, user rule 2026-09-26).
        const masterParts = particularsFromData(masterData) as Record<string, unknown>;
        const masterNow = (key: string): unknown =>
          key === 'name' ? locked.name : key === 'mmsi' ? locked.mmsi : key === 'callSign' ? locked.call_sign : masterParts[key];
        const externalOf = (key: string): { value: unknown } | null => {
          const lane = latestExternal(newMaster, key);
          if (lane) return lane;
          const own = masterNow(key);
          return own === null || own === undefined || own === '' ? null : { value: own };
        };
        const touch = (key: string, value: unknown): void => {
          const external = externalOf(key);
          if (external) {
            fleetData = withOverride(
              fleetData,
              key,
              sameValue(value, external.value)
                ? null
                : { value: value ?? null, author: admin.username, org: admin.orgSlug, at: now },
            );
            return;
          }
          if (key === 'name') columns.name = (value as string | null) ?? null;
          else if (key === 'mmsi') columns.mmsi = (value as string | null) ?? null;
          else if (key === 'callSign') columns.call_sign = (value as string | null) ?? null;
          else if (PARTICULARS_KEY_SET.has(key)) masterParticulars[key] = value ?? null;
        };
        if ('name' in input && input.name !== undefined) touch('name', input.name);
        if ('mmsi' in input) touch('mmsi', input.mmsi ?? null);
        if ('callSign' in input) touch('callSign', input.callSign ?? null);
        if (input.particulars) {
          for (const [key, value] of Object.entries(input.particulars)) {
            if (value !== undefined) touch(key, value);
          }
        }
        if ('certificates' in input) {
          // Only a source's expiry makes a typed date an override; a
          // certificate's own date is edited in place (spec 0086 amendment)
          for (const cert of input.certificates ?? []) {
            const key = certExpiryKey(cert.typeCode, cert.certificateId);
            const lane = latestExternal(newMaster, key);
            if (!lane) continue;
            const externalValue = lane.value;
            fleetData = withOverride(
              fleetData,
              key,
              sameValue(cert.expiryDate ?? null, externalValue)
                ? null
                : { value: cert.expiryDate ?? null, author: admin.username, org: admin.orgSlug, at: now },
            );
          }
        }
        if (Object.keys(masterParticulars).length > 0) {
          newMaster = applyParticularsToData(newMaster, masterParticulars as never);
        }

        const masterChanged =
          JSON.stringify(newMaster) !== JSON.stringify(masterData) ||
          columns.name !== undefined ||
          columns.mmsi !== undefined ||
          columns.call_sign !== undefined ||
          ('imoNumber' in input && input.imoNumber !== locked.imo_number);
        if (masterChanged) {
          await client.query(
            `UPDATE platform.ship SET
               name       = CASE WHEN $2::boolean THEN $3 ELSE name END,
               mmsi       = CASE WHEN $4::boolean THEN $5 ELSE mmsi END,
               call_sign  = CASE WHEN $6::boolean THEN $7 ELSE call_sign END,
               imo_number = CASE WHEN $8::boolean THEN $9 ELSE imo_number END,
               data       = $10::jsonb,
               updated    = now()
             WHERE id = $1`,
            [
              shipId,
              columns.name !== undefined,
              columns.name ?? null,
              columns.mmsi !== undefined,
              columns.mmsi ?? null,
              columns.call_sign !== undefined,
              columns.call_sign ?? null,
              'imoNumber' in input,
              input.imoNumber ?? null,
              JSON.stringify(newMaster),
            ],
          );
        }
        const fleetChanged = JSON.stringify(fleetData) !== JSON.stringify(asObject(locked.fleet_data));
        if (fleetChanged) {
          await client.query(`UPDATE fleet_ship SET data = $2::jsonb, updated = now() WHERE id = $1`, [
            locked.fleet_id,
            JSON.stringify(fleetData),
          ]);
        }
        const row = await this.readOne(client, admin, shipId);
        const changes = diffShip(oldRow, row);
        if (masterChanged) {
          await this.audit.content(
            {
              actorId: admin.username,
              entityType: 'ship',
              entityId: shipId,
              data: { action: 'updated', actorOrg: admin.orgSlug, changes },
            },
            client,
          );
        }
        if (fleetChanged || !masterChanged) {
          await this.audit.content(
            {
              actorId: admin.username,
              entityType: 'fleet_ship',
              entityId: locked.fleet_id,
              data: { action: 'overrides_updated', shipId, changes },
              schema,
            },
            client,
          );
        }
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(DUPLICATE_IMO);
      }
      throw error;
    }
  }

  /**
   * Drop the org's override for one field and use the master value again
   * (spec 0061 rule 3, per fleet since 0068). 404 when no source has
   * asserted the field or the org holds no override for it.
   */
  async useSource(admin: SessionUser, shipId: string, field: string): Promise<ShipRow> {
    const schema = await this.tenantDb.schemaFor(admin.orgSlug);
    return this.tenantDb.withOrg(admin.orgSlug, async (client) => {
      const before = await client.query(
        `SELECT ${SHIP_SQL}, ${FLEET_SQL} ${FLEET_LOCK_JOIN} WHERE s.id = $1 FOR UPDATE OF f`,
        [shipId],
      );
      if (before.rowCount === 0) throw new NotFoundException('The ship is not in your fleet');
      const locked: DbRow = before.rows[0];
      if (!locked.fleet_id) throw new NotFoundException('The ship is not in your fleet');
      const external: ExternalValue | null = latestExternal(locked.data ?? {}, field);
      if (!external) throw new NotFoundException('No external value for that field');
      if (!isIdentityKey(field) && !PARTICULARS_KEY_SET.has(field) && !parseCertExpiryKey(field)) {
        throw new BadRequestException('Unknown field');
      }
      const fleetData = asObject(locked.fleet_data);
      if (!(field in asObject(fleetData[OVERRIDES_KEY]))) {
        throw new NotFoundException('No override for that field');
      }
      await client.query(`UPDATE fleet_ship SET data = $2::jsonb, updated = now() WHERE id = $1`, [
        locked.fleet_id,
        JSON.stringify(withOverride(fleetData, field, null)),
      ]);
      const row = await this.readOne(client, admin, shipId);
      await this.audit.content(
        {
          actorId: admin.username,
          entityType: 'fleet_ship',
          entityId: locked.fleet_id,
          data: {
            action: 'override_cleared',
            shipId,
            field,
            source: external.source,
            value: external.value ?? null,
          },
          schema,
        },
        client,
      );
      return row;
    });
  }

  /**
   * Read what NEMO's ship database holds for this ship and keep it as the
   * shared "In NEMO" snapshot and the `nsd` lane (specs 0064, 0068): NSD
   * search by IMO (name when there is none) → the exact hit → the record.
   * No hit is recorded too (shipId null), so the ledger can say "not in
   * NEMO" and the onboarding rule (spec 0067 §5) can say what to do.
   * The credential is the acting org's unless a borrowing org is named
   * (the platform page and the sync borrow NEMO_REFDATA_ORG_SLUG's).
   * NEMO unreachable → 503 with the reason, nothing written.
   */
  async refreshFromNemo(
    viewer: SessionUser,
    shipId: string,
    credentialOrg: string = viewer.orgSlug,
  ): Promise<ShipRow> {
    const current = await this.tenantDb.withOrg(viewer.orgSlug, (client) =>
      client.query(`SELECT ${SHIP_SQL}, ${FLEET_SQL} ${FLEET_JOIN} WHERE s.id = $1`, [shipId]),
    );
    if (current.rowCount === 0) throw new NotFoundException();
    const before: DbRow = current.rows[0];
    const lookup = before.imo_number ?? before.name;
    if (!lookup) throw new BadRequestException('The ship has no IMO number or name to look up');

    // Outside the transaction: no row lock while NEMO answers.
    let record: NemoShipRecord | null = null;
    try {
      const hits = await this.nemo.findShips(credentialOrg, lookup);
      const hit = hits.find((h) =>
        before.imo_number
          ? h.imoid === before.imo_number
          : (h.name ?? '').toUpperCase() === (before.name ?? '').toUpperCase(),
      );
      if (hit?.id) record = await this.nemo.getShip(credentialOrg, hit.id);
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof NemoApiError && error.status === 403
          ? NSD_REFUSED_WORDS
          : `NEMO could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return this.tenantDb.withOrg(viewer.orgSlug, async (client) => {
      const fresh = await client.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM platform.ship WHERE id = $1 FOR UPDATE`,
        [shipId],
      );
      if (fresh.rowCount === 0) throw new NotFoundException();
      const landed = nsdReadIntoData(fresh.rows[0]!.data ?? {}, record);
      await client.query(
        `UPDATE platform.ship SET
           data      = $2::jsonb,
           name      = CASE WHEN $3::boolean THEN $4 ELSE name END,
           mmsi      = CASE WHEN $5::boolean THEN $6 ELSE mmsi END,
           call_sign = CASE WHEN $7::boolean THEN $8 ELSE call_sign END,
           updated   = now()
         WHERE id = $1`,
        [
          shipId,
          JSON.stringify(landed.data),
          'name' in landed.columns,
          landed.columns.name ?? null,
          'mmsi' in landed.columns,
          landed.columns.mmsi ?? null,
          'callSign' in landed.columns,
          landed.columns.callSign ?? null,
        ],
      );
      const row = await this.readOne(client, viewer, shipId);
      await this.audit.content(
        {
          actorId: viewer.username,
          entityType: 'ship',
          entityId: shipId,
          data: {
            action: 'nemo_snapshot',
            actorOrg: viewer.orgSlug,
            shipId: landed.snapshot.shipId,
            found: record !== null,
            fieldCount: Object.keys(landed.snapshot.fields).length,
            certificateCount: landed.snapshot.certificates.length,
            source: landed.snapshot.source,
          },
        },
        client,
      );
      return row;
    });
  }

  // ---- the platform page (spec 0068) ---------------------------------------

  /** The whole master list, unmasked, with the fleets each ship is in. */
  async listAll(viewer: SessionUser): Promise<PlatformShipRow[]> {
    const orgs = await this.tenantDb.activeOrgs();
    const ships = await this.tenantDb.platform(async (client) => {
      const rows = await client.query(
        `SELECT ${SHIP_SQL} FROM platform.ship s
          ORDER BY s.is_active DESC, s.name NULLS LAST, s.created DESC`,
      );
      const fleets = new Map<string, string[]>();
      for (const org of orgs) {
        const members = await client.query<{ ship_id: string }>(
          `SELECT ship_id FROM ${org.schema}.fleet_ship WHERE is_active`,
        );
        for (const m of members.rows) {
          fleets.set(m.ship_id, [...(fleets.get(m.ship_id) ?? []), org.slug]);
        }
      }
      return rows.rows.map((r: DbRow) => ({
        ...toRow(r, viewer, this.nemoUiUrl),
        fleets: fleets.get(r.id) ?? [],
      }));
    });
    return ships;
  }

  /** Platform-wide activation (spec 0067 §2, platform admins only since 0068). */
  async setActive(viewer: SessionUser, shipId: string, active: boolean): Promise<void> {
    try {
      await this.tenantDb.platform(async (client) => {
        const result = await client.query(
          `UPDATE platform.ship SET is_active = $2, updated = now() WHERE id = $1 RETURNING id`,
          [shipId, active],
        );
        if (result.rowCount === 0) throw new NotFoundException();
        await this.audit.content(
          {
            actorId: viewer.username,
            entityType: 'ship',
            entityId: shipId,
            data: { action: active ? 'activated' : 'deactivated', actorOrg: 'platform' },
          },
          client,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An active ship with this IMO number already exists on the master list');
      }
      throw error;
    }
  }
}
