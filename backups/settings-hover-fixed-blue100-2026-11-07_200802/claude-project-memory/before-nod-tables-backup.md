---
name: before-nod-tables-backup
description: "app/src copy from 2026-11-07, before every list table was made like Send to NEMO: NOD (old NOA FormalityLedger.vue deleted)"
metadata:
  type: project
---

On 2026-11-07 the user asked to make all list tables like the Send to NEMO: NOD one. NOA facts/send now use NodFormalityLedger (code-on-hover, can-edit-call); the old components/FormalityLedger.vue was deleted; FormalityItems' roomy mode restyled to NOD values and used in the port call card too.

Backup: `~/Downloads/nemolink-versions/before-nod-tables-2026-11-07/app/src` (verified with diff -rq).

**Why:** the project is not a git repo; the user wants a restore point before UI changes.
**How to apply:** restore only after the user confirms, then rebuild per [[app-docker-rebuild]].
