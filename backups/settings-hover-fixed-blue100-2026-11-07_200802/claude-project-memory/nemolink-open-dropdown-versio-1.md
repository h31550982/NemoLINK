---
name: nemolink-open-dropdown-versio-1
description: "Open dropdown - version 1" = NEMOLink snapshot of the redesigned opened port call card (2026-10-20); run it side by side on :3962
metadata:
  type: project
---

The user saved a checkpoint named **open dropdown - version 1** on 2026-10-20 at 23:30. It holds the redesigned opened port call card: stage columns in the header, a numbered 5-step rail, the drop zone before the files, and Cancel under Edit. It lives in `~/Downloads/nemolink-versions/open-dropdown-versio-1/`, with the same layout as [[nemolink-versio-1]]:
- `source/`: the code (without node_modules)
- `database.sql`: a pg_dump
- `docker-compose.yml`: compose project `nemolink-open-dropdown-v1`, containers `nemolink-odv1-*`, images `nemolink-{app,server,nemo-mock}:open-dropdown-v1`. The server image is the same build as `:versio-1`, because the server code did not change.
- `LUEMINUT.md`: the instructions, in Finnish

**Why:** the user wants restore points of the UI work that they can view without touching the working copy.

**How to apply:**
- When the user asks to show this version ("näytä open dropdown versio 1"), run `docker compose -f ~/Downloads/nemolink-versions/open-dropdown-versio-1/docker-compose.yml up -d` and open http://localhost:3962 (admin@demo.example / demo-password-123). The current version stays on :3960 and versio 1 on :3961.
- Stop it with `down -v`.
- Overwrite ~/Downloads/nemolink with `source/` (rsync) only if the user explicitly asks to restore (palauta).
- Before pruning images, check that the `:open-dropdown-v1` tags are kept.
- The next checkpoint gets the next free port (:3963).
