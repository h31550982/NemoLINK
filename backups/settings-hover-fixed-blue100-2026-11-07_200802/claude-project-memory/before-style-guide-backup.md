---
name: before-style-guide-backup
description: Plain copy of app/ taken 2026-10-30 just before the visual style guide v1.0 restyle — the way back if the user wants the old look
metadata:
  node_type: memory
  type: project
  originSessionId: 20c44496-e60f-4fa4-a162-0c4f97727595
  modified: 2026-10-30T13:25:26.195Z
---

On 2026-10-30 the frontend was restyled to the "NemoLINK visual style guideline v1.0" PDF (Instrument Sans, #363ADD blue, white header, list/card switch on the front page). Just before that, `app/` (without node_modules) was copied to `~/Downloads/nemolink-versions/before-style-guide-2026-10-30/app/`.

**Why:** the restyle touched global tokens (app.scss, quasar.variables.scss), so every screen changed; the project is not a git repo.

**How to apply:** if the user wants the old look back, rsync that folder over `~/Downloads/nemolink/app/` (excluding node_modules) only after they confirm, then rebuild per [[app-docker-rebuild]]. It is a plain file copy, not a full checkpoint like [[nemolink-versio-1]] (no DB dump, no compose file).
