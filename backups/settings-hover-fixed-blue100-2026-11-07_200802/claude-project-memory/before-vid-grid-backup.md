---
name: before-vid-grid-backup
description: app/src copy from 2026-11-07, before Send to NEMO (VID) steps 2–4 got the Pre-arrival grid and NOD lost its heading
metadata:
  type: project
---

On 2026-11-07 the user asked: NOD drop "This goes to NEMO - N missing"; VID step 2 drop "In NEMO" heading, "Ship data" heading without paragraph; VID steps on the Pre-arrival This goes to NEMO grid; step 3 field table in the NOD list-table style with Report before NEMO ID; CRT result dropdowns closed by default.

Backup: `~/Downloads/nemolink-versions/before-vid-grid-2026-11-07/app/src` (verified with diff -rq).

**Why:** the project is not a git repo; the user wants a restore point before UI changes.
**How to apply:** restore only after the user confirms, then rebuild per [[app-docker-rebuild]].
