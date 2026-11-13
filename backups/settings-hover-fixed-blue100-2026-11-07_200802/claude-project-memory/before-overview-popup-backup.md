---
name: before-overview-popup-backup
description: "app/src copy from 2026-11-06, before the port call pop-up went back to version 3 without the side list and time fields"
metadata:
  node_type: memory
  type: project
  originSessionId: ff3ae478-0df2-4468-a932-fd776e4d6df6
  modified: 2026-11-05T23:17:36.151Z
---

On 2026-11-06 the opened port call pop-up (PortCallBlock.vue) was rebuilt from version 3 (the 1240px two-column pop-up, backup before-side-nav-popup-2026-11-04) as the user asked: no left section list, no time fields (ETA/ETD/ATA/ATD pens, ScheduleDialog and the Save changes button removed), the port call card left and a reports overview right on top (every report in sending order: Port call, Ship data, Pre-arrival incl. the reports ticked to go with the NOA from noaPreview, Arrival, Pre-departure, Departure), then Ship documents, As applicable, Audit. 1240px, full height, Cancel port call alone in the footer.

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-overview-popup-2026-11-06/app/src` and verified with `diff -rq`. That copy is the side-list version (4th) with the Actual section already removed.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing it over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-ata-atd-picker-backup]], [[before-side-nav-popup-backup]].
