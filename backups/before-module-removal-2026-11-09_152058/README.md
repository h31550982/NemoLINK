# Saved version: before module removal

Version: `waste_type.json`.
Created: 2026-11-09T15:20:58.518520+02:00 (Europe/Helsinki).
Original project: `/Users/sofiamesterton/Downloads/nemolink`.

This restore point preserves the full project before removing most modules.

## Contents

- `project/`: all current application and server source, modules, assets, tests, local configuration (including environment files), lockfiles, Docker configuration, migrations, database schema, vendor files, and project instructions.
- `database.dump`: a consistent snapshot of the current local PostgreSQL database, in custom archive format.
- `source-manifest.json`: source file hashes and sizes.
- `snapshot.json`: version metadata and verification results.
- `SHA256SUMS`: checksums for the saved files and metadata.

Generated dependencies and builds (`node_modules`, `dist`, `.quasar`), Git metadata, caches, logs, OS files, and older backups are excluded. Dependencies can be installed from the saved lockfiles with `npm ci` in `app/` and `server/`.

## Restore

Ask: "Restore version waste_type.json."

Before restoring, save the then-current working version. Restore the complete `project/` tree to recover all modules; remove files introduced later when necessary, while preserving the live `backups/` directory. Rebuild the restored services with `docker compose up -d --build`.

If restoring the saved data is also required, first save the then-current database, stop services that write to it, and restore `database.dump` using PostgreSQL 18 `pg_restore`. Restoring source alone does not require restoring the database.

## Verification

All 604 saved source files matched the originals by SHA-256, and the complete source file list was checked again after the database backup. The database archive was fully read with `pg_restore --file=/dev/null` successfully. No modules were removed while creating this version.

To verify the saved files, run from this backup directory:

```sh
shasum -a 256 -c SHA256SUMS
```
