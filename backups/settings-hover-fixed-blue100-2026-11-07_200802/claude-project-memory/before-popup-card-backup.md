---
name: before-popup-card-backup
description: "app/src copy from 2026-11-04, before the opened port call card became a pop-up (no dropdown)"
metadata:
  node_type: memory
  type: project
  originSessionId: 9e84ff18-90f2-43f9-a4b7-4ca8e2fbd6b5
  modified: 2026-11-04T16:59:42.259Z
---

On 2026-11-04, before turning the opened port call card (PortCallBlock.vue, a q-expansion-item dropdown) into a pop-up modelled on canvas artboard "E4 · Voyage + reports overview on the right copy" (PcE4r-h0yc, design canvas https://claude.ai/artifact/5bViBqBG2RFAVjFJnjV8Qy), `app/src` was copied to `~/Downloads/nemolink-versions/before-popup-card-2026-11-04/app/src` and verified with `diff -rq`.

The new pop-up: HouseDialog 1240px wide and full height (the Ship forms size with All details on), with the see-through backdrop. The ETA/ETD/ATA/ATD pens open ScheduleDialog (new `actual` prop for ATA/ATD). Voyage and cargo appear in the right overview with Edit port call. The files list is always open.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing that src over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-schedule-wizard-backup]].
