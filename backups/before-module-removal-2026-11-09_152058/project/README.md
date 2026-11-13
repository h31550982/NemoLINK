# NEMOLink — UI/UX study copy

NEMOLink connects shipping companies' systems to the Finnish Maritime Single Window
(NEMO): port calls, crew and passenger lists, certificates and the other formalities
a ship sends before it arrives.

This is a **local study copy for UI/UX work**:

- Customer data, sample files, integrations, deployment and backup setup, runbooks
  and specs have been removed. Organisation and ship names in tests are fictional.
- **There is no real NEMO connection.** The staging and production endpoints and
  NEMO sign-in are removed from the code; every "send to NEMO" goes to a local mock
  (`nemo-mock`), which answers with generated example data.
- Reference data comes from public sources on first start: NEMO codelists and
  the HS map from `vendor/`, ~115 000 locations from Fintraffic's public NEMO hub,
  and a ship list from Digitraffic's public port-call feed.

## Start everything

Prereqs: Docker Desktop.

```
docker compose up -d --build
```

Open <http://localhost:3960> and sign in:

| User | Password | Role |
|---|---|---|
| `admin@demo.example` | `demo-password-123` | admin of the "Demo Shipping Oy" organisation |
| `platform@demo.example` | `demo-password-123` | platform admin (sees the platform pages) |

The first start takes a few minutes (image builds, then the worker loads the
reference data). `docker compose logs -f nemolink-worker` shows the loading.

## Work on the UI with hot reload

Keep the database, worker and NEMO mock in Docker, and run the server and the app
on your machine so every save reloads instantly. Prereqs: Node 22+.

```
docker compose up -d --build                     # once, so the demo users exist
docker compose stop nemolink-server nemolink-app # free ports 3000 and 3960

# terminal 1: API on :3000
cd server
copy .env.example .env        # (macOS/Linux: cp)
npm install
npm run dev

# terminal 2: UI on :9000 (proxies /api to :3000)
cd app
npm install
npm run dev
```

Open <http://localhost:9000>. Changes in `app/src` show up immediately; changes in
`server/src` restart the API automatically.

## More users and organisations

```
docker compose exec nemolink-server node dist/scripts/provision-org.js acme "Acme Lines Oy"
echo "a-long-password" | docker compose exec -T nemolink-server node dist/scripts/create-user.js acme captain@acme.example --role captain --type local --password-stdin
```

Roles: `admin`, `editor`, `viewer`, `captain`, `superadmin` (platform). Each sees a
different UI, so it is worth making one of each. (With hot reload, run the same
scripts from `server/` after `npm run build`, without the `docker compose exec`.)

## Layout

| Path | What |
|---|---|
| `app/` | Quasar frontend (Vue 3 + TypeScript): **the main place to work** |
| `server/` | NestJS backend (API + worker) |
| `schema.sql` | The database schema, full latest state |
| `migrations/` | Dated migrations, applied automatically at boot |
| `vendor/` | Public reference data from NEMO and the National Spreadsheet (read-only) |
| `tools/nemo-mock/` | The local NEMO mock (Prism, from the vendored OpenAPI spec) |

## Known limits of this copy

- Sends to NEMO answer with mock data, not with real NEMO validation results.
- The NEMO ship database, the hazmat list and email sending are not available.
  The UI shows them as not configured or unavailable.
- The status light says "NEMO changed contract files upstream". That is expected
  in this copy.

## Reset

```
docker compose down -v     # removes the containers AND the database
```

## Checks

```
cd server && npm test && npm run typecheck
cd app && npm run typecheck
```
