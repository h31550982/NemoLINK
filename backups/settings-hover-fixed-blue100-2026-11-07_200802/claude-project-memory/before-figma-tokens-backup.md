---
name: before-figma-tokens-backup
description: "Plain copy of app/ taken 2026-11-02 just before switching tokens to the Figma \"Colors (Variables)\" + \"Text Styles\" frames"
metadata:
  node_type: memory
  type: project
  originSessionId: f91ba543-dc48-49e8-9bb4-6abb415c01d6
  modified: 2026-11-01T22:45:57.745Z
---

On 2026-11-02, before the tokens in app.scss / quasar.variables.scss were moved from style guide v1.0 to the Figma variables (see [[figma-design-guideline]]), `app/` (no node_modules) was copied to `~/Downloads/nemolink-versions/before-figma-tokens-2026-11-02/app/` and verified identical with `diff -rq`.

**Why:** the user explicitly required a backup of the current version before any change; the project is not a git repo.

**How to apply:** to restore, rsync that folder over `~/Downloads/nemolink/app/` (excluding node_modules) only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older backup: [[before-style-guide-backup]].
