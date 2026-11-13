---
name: before-side-nav-popup-backup
description: app/src copy from 2026-11-04, before the port call pop-up got the left section list (canvas PcQ3-iatg)
metadata:
  type: project
---

On 2026-11-04 the opened port call pop-up (PortCallBlock.vue) was changed from the two-column layout (canvas "E4 · Voyage + reports overview on the right copy") to the canvas artboard "Q3 · Port call status next to the ship name copy" (PcQ3-iatg). The new layout has a 260px section list on the left (Estimated / Actual / Ship documents / Reports summary, each with its pills), the overview card (Port, Route, Voyage, Cargo, ETA, ETD + Edit port call) above the chosen section, and the files behind a chevron again. Later the same day the user narrowed it from 1240 to 964px (260 list + 704 content, 34px sides) so that Cancel port call's right edge lines up with the content, and put Save changes on the left, Cancel port call on the right (HouseDialog main-first).

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-side-nav-popup-2026-11-04/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing that src over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-popup-card-backup]].
