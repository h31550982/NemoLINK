---
name: before-dropdown-components-backup
description: "app/src copy from 2026-11-06, before the Figma dropdown components (557:7884) were applied to every dropdown and form field"
metadata:
  node_type: memory
  type: project
  originSessionId: 3ecc2efb-43cb-4c23-b6dc-3a7e1bf119be
  modified: 2026-11-06T20:54:00.743Z
---

On 2026-11-06 the user asked to apply the new Figma dropdown components (frame 557:7884) to the product. Decisions: every q-select gets the look; all form fields (text inputs too) take the components' label/description spacing and 1px Blue/700 box; port list = top 3 most-used in SemiBold, no group headings; Figma components made responsive + given component properties.

Backup: `~/Downloads/nemolink-versions/before-dropdown-components-2026-11-06/app/src` (verified with diff -rq).

**Why:** the project is not a git repo; the user wants a restore point before UI changes.
**How to apply:** restore only after the user confirms, then rebuild per [[app-docker-rebuild]].
