# Ensaio

A small feature-flag platform, built to learn the same stack PostHog uses for Feature Flags. The name is Portuguese for "trial" or "rehearsal". Ensaio is an original project with no affiliation to PostHog or any other company, and it is built from public information only.

**What works today:** M0–M5: the scaffold, pure evaluation kernel, management API, React/Kea console, server/local evaluation APIs, and health-gated rollouts. Authenticated staff users can manage and trace project-scoped flags, attach a phased rollout, push absolute-threshold guardrail samples, and advance, hold, pause, or revert the managed release condition. Consumers can evaluate live flags through PostHog-shaped `POST /flags/?v=2`, or fetch secret-authenticated definitions with ETag/304 support and run the same kernel locally.

## Quickstart

Requirements: Docker, uv, Node 24, and Corepack (ships with Node; it provides pnpm 10.29.3).

```bash
./bin/setup
./bin/start
```

- Console: http://127.0.0.1:5173/feature_flags — list, create, edit, and trace flags for the team configured on the HTML shell.
- API liveness: http://127.0.0.1:8000/healthz — responds `ok` and does not touch the database.
- Management API: http://127.0.0.1:8000/api/projects/1/feature_flags/ — session-authenticated.
- Evaluation API: `POST http://127.0.0.1:8000/flags/?v=2` — public project token in the JSON body.
- Definitions API: `GET http://127.0.0.1:8000/flags/definitions` — secret bearer token; supports `If-None-Match`.
- Rollout plan API: `GET/PUT/DELETE .../feature_flags/<id>/rollout_plan/`; samples: `POST .../<id>/guardrail_samples/`.
- OpenAPI: http://127.0.0.1:8000/api/schema/ — committed at `frontend/openapi.json`.

Postgres is the only container (`postgres:15.12-alpine` on port 5432). Django and Vite run on the host so edits reload without an image rebuild.

```bash
./bin/test   # ruff, mypy, tach, pytest (including kernel vectors), tsc, oxlint, oxfmt, jest
cd frontend && corepack pnpm run test:smoke   # Playwright create-and-trace flow
```

Conventions for people and agents: [`AGENTS.md`](AGENTS.md).
The hashing decision and its verified PostHog sources are in [`ADR-1`](docs/adr/0001-posthog-compatible-hashing.md); definitions polling and ETags are in [`ADR-3`](docs/adr/0003-definitions-etag-and-polling.md); the rollout controller is in [`ADR-4`](docs/adr/0004-health-gated-rollout-controller.md).
