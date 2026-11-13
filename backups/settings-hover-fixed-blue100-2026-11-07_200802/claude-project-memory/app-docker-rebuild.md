---
name: app-docker-rebuild
description: "Frontend on :3960 is a built Docker image, no hot reload — rebuild after UI edits"
metadata:
  node_type: memory
  type: project
  originSessionId: 41e601c9-d7b4-4b84-b28c-cb4bb4962b6b
  modified: 2026-10-20T20:34:04.187Z
---

The app the user views at http://127.0.0.1:3960 is the `nemolink-app` container built from app/Dockerfile (nginx serving a build), not a dev server.

**Why:** After editing app/src the user saw no changes until the image was rebuilt (2026-10-20).
**How to apply:** After frontend edits, run `docker compose up -d --build --no-deps nemolink-app` from the repo root, then tell the user to hard-refresh.
