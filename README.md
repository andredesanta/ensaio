# Ensaio

A small feature-flag platform, built to learn the same stack PostHog uses for Feature Flags. The name is Portuguese for "trial" or "rehearsal". Ensaio is an original project with no affiliation to PostHog or any other company, and it is built from public information only.

**What works today:** the scaffold. Postgres starts, Django answers `/healthz`, and the React console boots to an empty page. There is no flag evaluation yet. This README will list a feature only after a test covers it.

## Quickstart

Requirements: Docker, uv, Node 24, and Corepack (ships with Node; it provides pnpm 10.29.3).

```bash
./bin/setup
./bin/start
```

- Console: http://127.0.0.1:5173 — empty page. That is the milestone.
- API liveness: http://127.0.0.1:8000/healthz — responds `ok` and does not touch the database.
- OpenAPI (empty until the flag API exists): http://127.0.0.1:8000/api/schema/

Postgres is the only container (`postgres:15.12-alpine` on port 5432). Django and Vite run on the host so edits reload without an image rebuild.

```bash
./bin/test   # ruff, mypy, tach, pytest, tsc, oxlint, jest
```

Conventions for people and agents: [`AGENTS.md`](AGENTS.md).
