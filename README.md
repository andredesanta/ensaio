# Ensaio

A small feature-flag platform, built to learn the same stack PostHog uses for Feature Flags. The name is Portuguese for "trial" or "rehearsal". Ensaio is an original project with no affiliation to PostHog or any other company, and it is built from public information only.

**What works today:** the M0 scaffold, pure M1 evaluation kernel, M2 management API, and M3 React/Kea console. Authenticated staff users can create, list, edit, soft-delete, and trace project-scoped feature flags through Django REST Framework. The browser console supports search, active toggles, condition and variant editing, and ordered decision traces. Frontend API types are generated from the committed OpenAPI contract.

## Quickstart

Requirements: Docker, uv, Node 24, and Corepack (ships with Node; it provides pnpm 10.29.3).

```bash
./bin/setup
./bin/start
```

- Console: http://127.0.0.1:5173/feature_flags — list, create, edit, and trace flags for the team configured on the HTML shell.
- API liveness: http://127.0.0.1:8000/healthz — responds `ok` and does not touch the database.
- Management API: http://127.0.0.1:8000/api/projects/1/feature_flags/ — session-authenticated.
- OpenAPI: http://127.0.0.1:8000/api/schema/ — committed at `frontend/openapi.json`.

Postgres is the only container (`postgres:15.12-alpine` on port 5432). Django and Vite run on the host so edits reload without an image rebuild.

```bash
./bin/test   # ruff, mypy, tach, pytest (including kernel vectors), tsc, oxlint, oxfmt, jest
cd frontend && corepack pnpm run test:smoke   # Playwright create-and-trace flow
```

Conventions for people and agents: [`AGENTS.md`](AGENTS.md).
The hashing decision and its verified PostHog sources are in [`ADR-1`](docs/adr/0001-posthog-compatible-hashing.md).
