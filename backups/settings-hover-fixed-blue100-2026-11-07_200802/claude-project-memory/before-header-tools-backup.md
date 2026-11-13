---
name: before-header-tools-backup
description: app/src copy from 2026-11-02, before search + New port call moved from the app header into the front-page head
metadata:
  type: project
---

On 2026-11-02, before implementing Figma 341:5720 (search and New port call moved out of the app header into the front page's head, card-view toggle replaced by a list/cards icon switch), `app/src` was copied to `~/Downloads/nemolink-versions/before-header-tools-2026-11-02/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing that src over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-figma-tokens-backup]].
