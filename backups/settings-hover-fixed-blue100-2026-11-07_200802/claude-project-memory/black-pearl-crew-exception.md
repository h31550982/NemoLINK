---
name: black-pearl-crew-exception
description: "Black Pearl's National Spreadsheet crew files were accepted as nsw-crew by hand (DB only) — a one-off exception, never make that format supported in code"
metadata:
  node_type: memory
  type: feedback
  originSessionId: a2200093-83a3-4ed2-9179-3ea234c76348
  modified: 2026-10-29T20:32:36.925Z
---

The user's Black Pearl crew sheets are NEMO National Spreadsheet exports (.xlsx), which the parser rightly reports as "unrecognized". The user asked to accept them anyway, **as an exception only**:

- Done by a direct DB update of `org_demo.port_call_document` (form_type='nsw-crew', context='arrival', parse_status='parsed', parsed/summary copied from doc `e63722ea…`, which holds the same 9 crew). No code changed.
- Applied to: Hamina call `df47863e` (doc e63722ea), happy-path Hamina call `917095e1` (doc 7cb71d8c, 2026-10-29), Dragsfjärd 30.10 call `424d0bc6` (doc 3e2a4c3d, 2026-10-29).

**Why:** user said "ignore it is in a wrong format but dont make this format actually possible, this is an exception" and "remember this is an exception".
**How to apply:** never add National Spreadsheet → crew-list parsing to form-parser.ts or treat it as a supported upload format. If asked again for a Black Pearl file, repeat the manual DB exception for that one document only, and say it's an exception. Related: [[localhost-credentials]].
