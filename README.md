# Ensaio

A small feature-flag platform, built to learn the same stack PostHog uses for Feature Flags. The name is Portuguese for "trial" or "rehearsal". Ensaio is an original project with no affiliation to PostHog or any other company, and it is built from public information only.

**What works today:** the M0 scaffold and the pure M1 evaluation kernel. Postgres starts, Django answers `/healthz`, and the React console boots to an empty page. `ensaio_kernel` evaluates boolean and multivariate definitions without Django or I/O, uses PostHog-compatible SHA-1 bucketing, supports the scoped property-operator set, and returns a decision trace. Fifteen golden vectors and PostHog's published Rust hash values protect the contract. The Django flag API and console scenes do not exist yet.

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
./bin/test   # ruff, mypy, tach, pytest (including kernel vectors), tsc, oxlint, oxfmt, jest
```

Conventions for people and agents: [`AGENTS.md`](AGENTS.md).
The hashing decision and its verified PostHog sources are in [`ADR-1`](docs/adr/0001-posthog-compatible-hashing.md).
