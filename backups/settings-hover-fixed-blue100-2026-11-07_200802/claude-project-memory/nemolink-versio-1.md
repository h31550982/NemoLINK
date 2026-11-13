---
name: nemolink-versio-1
description: "Versio 1" = saved snapshot of NEMOLink (2026-10-20); "näytä versio 1" means start it side by side on :3961 without touching the working copy
metadata:
  type: project
---

The user saved a restore point named **versio 1** on 2026-10-20 at 22:50. It lives in `~/Downloads/nemolink-versions/versio-1/`:
- `source/`: the code (without node_modules)
- `database.sql`: a pg_dump that includes the Black Pearl port call to FIHMN
- `docker-compose.yml`: compose project `nemolink-versio-1`, which uses the images `nemolink-app:versio-1`, `nemolink-server:versio-1` and `nemolink-nemo-mock:versio-1`
- `LUEMINUT.md`: the instructions

**Why:** the user wants to view the old version later without editing it or overwriting the current work.

**How to apply:**
- When the user says "näytä versio 1", run `docker compose -f ~/Downloads/nemolink-versions/versio-1/docker-compose.yml up -d`, then open http://localhost:3961 (admin@demo.example / demo-password-123). The current version stays on :3960.
- Stop it with `down -v`, which resets the DB back to the snapshot.
- Overwrite ~/Downloads/nemolink with `source/` (rsync) only if the user explicitly asks to *restore* (palauta), not just to view.
- Before deleting dangling images, check that the `:versio-1` tags are kept.
