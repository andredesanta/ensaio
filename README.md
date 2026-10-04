# Ensaio

Ensaio is a small, working feature-flag platform built to understand the architecture and engineering trade-offs behind PostHog's Feature Flags product. It combines a pure deterministic evaluation kernel, a Django management and evaluation API, a React/Kea console, local-evaluation definition polling, and a deliberately small health-gated rollout controller. _Ensaio_ is Portuguese for “trial” or “rehearsal.”

This is an original learning project. It is not affiliated with, endorsed by, or copied from PostHog or any employer. The PostHog observations in this repository come only from public source and are labeled as verified or inferred.

## Demo

The reproducible browser journey creates a targeted multivariate flag, inspects its evaluation trace, activates a phased rollout, and reverts it:

![Ensaio feature flag create, trace, and rollout-revert demo](docs/assets/ensaio-demo.gif)

Re-record it from mocked deterministic API responses with `./bin/record-demo`. This requires Chromium and `ffmpeg`; it does not require a running backend.

## What is implemented

- A pure `ensaio_kernel` package with PostHog-compatible SHA-1 bucketing, ordered release conditions, property operators, multivariate variants, payloads, reason codes, and optional traces.
- Team-scoped Django/DRF CRUD with strict `filters` validation, soft deletion, per-write versions, session authentication, and a trace endpoint.
- A React 18 + TypeScript console whose feature state and side effects live in Kea logics. API models are generated from the DRF OpenAPI schema.
- A deliberately small PostHog-shaped `POST /flags/?v=2` endpoint that returns detailed flag results for one project token.
- A secret-authenticated `GET /flags/definitions` endpoint for local evaluation, including ETag/304 polling and post-commit cache invalidation.
- A health-gated staged rollout controller with a pure decision function, idempotent plan API, guardrail samples, per-plan transactions, row locks, hold/pause behavior, and percentage-only reverts.
- Full Python and TypeScript static checks, backend and frontend unit tests, API schema-drift checks, package-boundary checks, and a mocked Playwright product smoke test.

Everything above is implemented and covered by the repository's verification commands; the browser smoke and production build run separately from `./bin/test` and also run in CI. The limitations section is equally important: this is not a production PostHog replacement.

## 60-second local quickstart

Prerequisites:

- Docker with Compose;
- [uv](https://docs.astral.sh/uv/);
- Node.js 24 with Corepack; and
- ports 5432, 8000, and 5173 available.

Install dependencies and create idempotent local demo data:

```bash
./bin/setup
./bin/bootstrap-demo
```

Start PostgreSQL, Django, and Vite:

```bash
./bin/start
```

`bin/start` stays in the foreground and stops Django/Vite when you press Ctrl+C. PostgreSQL is the only container; application processes run on the host for fast reloads.

1. Sign in at <http://127.0.0.1:8000/admin/login/> with `admin` / `ensaio`.
2. Open <http://127.0.0.1:5173/feature_flags>.
3. Create a flag, open **Trace**, and try `u_7` with `{"country":"BR"}`.

The bootstrap credentials are intentionally local and insecure. Do not use them outside this development setup. A first dependency download can take longer than a minute; repeat boots are the intended 60-second path.

Useful endpoints:

- liveness: <http://127.0.0.1:8000/healthz>;
- management API: <http://127.0.0.1:8000/api/projects/1/feature_flags/>;
- evaluation API: `POST http://127.0.0.1:8000/flags/?v=2`;
- definitions API: `GET http://127.0.0.1:8000/flags/definitions`;
- OpenAPI schema: <http://127.0.0.1:8000/api/schema/>.

## Architecture

```text
React/Kea console
      │ session-authenticated generated client
      ▼
Django/DRF management API ───────────────────────▶ PostgreSQL 15
      │                                                 │
      │ copies ORM state into an immutable value        │ definitions
      ▼                                                 ▼
ensaio_kernel.evaluate() ◀── POST /flags       GET /flags/definitions
      ▲                   live server path       secret + ETag polling
      │
local consumer evaluates downloaded definitions without another request

tick_rollouts ─▶ pure decide(plan, samples, now) ─▶ transactional ORM effects
```

The main boundary is intentional:

- `products/feature_flags/backend/` owns I/O, tenancy, authentication, transactions, and persistence;
- `packages/ensaio_kernel/` owns deterministic evaluation and imports neither Django nor product code;
- `products/feature_flags/frontend/` owns the feature's scenes and Kea state; `frontend/` is only the Vite shell and shared UI;
- serializers generate OpenAPI, OpenAPI generates TypeScript models, and CI rejects generated drift.

[`tach.toml`](tach.toml), Ruff's forbidden-import rules, and `tach check-external` make the Python boundary executable rather than aspirational.

## Evaluation contract

One condition is an AND of its property filters followed by deterministic rollout bucketing. Conditions are tried as an ordered OR and the first complete match wins. Multivariate selection uses a second salted hash, so rollout inclusion and variant assignment are independent.

The compatibility claim is deliberately narrow: after an application has selected a `distinct_id`, Ensaio uses PostHog's v1 SHA-1 hash and bucket boundaries. Ensaio does not claim full matcher, identity, cohort, group, payload, or `/flags` parity. [ADR-1](docs/adr/0001-posthog-compatible-hashing.md) and [ADR-5](docs/adr/0005-identity-and-caller-supplied-properties.md) spell out the exact boundary.

The mandatory public-source cross-check is complete: Ensaio reproduces the published Rust hash vectors. The optional live PostHog Cloud cross-check was not performed, so no cloud-observed results or credentials are part of this repository.

## Evaluation microbenchmark

Run:

```bash
uv run python scripts/bench_eval.py
```

Baseline on Python 3.14.7, macOS 26.6.2, arm64; seven rounds of 100,000 iterations after 10,000 warmups:

| Operation | Median µs/op | Median ops/s | Min–max µs/op |
| --- | ---: | ---: | ---: |
| `hash_position` | 0.517 | 1,933,703 | 0.499–0.531 |
| `evaluate_boolean_100_percent` | 2.075 | 481,855 | 2.057–2.141 |
| `evaluate_targeted_multivariate` | 6.444 | 155,178 | 6.393–6.532 |

This is a local in-process microbenchmark, not a load test or production capacity claim. It excludes Django, SQL, HTTP, JSON, cache behavior, concurrency, and tail latency. It is useful as a reproducible regression baseline for the pure kernel only.

## Development and verification

```bash
./bin/test
```

That single command runs Ruff lint and format checks, mypy, both tach boundary checks, OpenAPI schema drift detection, pytest, TypeScript checking, Oxlint, Oxfmt, and Jest.

Additional checks:

```bash
cd frontend
corepack pnpm exec playwright install chromium
corepack pnpm run test:smoke
corepack pnpm run build
cd ..

uv run python manage.py tick_rollouts
```

CI additionally runs `corepack pnpm run generate` and requires a clean Git diff, then runs the production build and Playwright smoke. Kea typegen's volatile header timestamp is normalized by `frontend/scripts/normalize-kea-typegen.mjs`, so generated drift represents a real contract change.

After changing a serializer, view, route, or Kea logic:

```bash
./bin/generate-schema
cd frontend
corepack pnpm run generate
```

Do not hand-edit `frontend/openapi.json`, generated API models, or `*LogicType.ts` files.

## What I noticed using and reading PostHog

- Hash compatibility depends on tiny choices—prefix, salt, 60-bit slice, inclusive versus strict boundaries, list order—not merely on using SHA-1.
- Identity selection happens before hashing. Group keys, device bucketing, and anonymous-to-identified continuity are product policy, not hash details.
- The v2 response contract includes serde casing and omission behavior; it cannot be reconstructed safely from Python naming conventions.
- A successful database write is not the end of configuration propagation. Post-commit invalidation, versioned messages, builders, and repair loops make runtime freshness a system.
- Time-scheduled changes and experiment analysis are adjacent to, but not the same primitive as, Ensaio's sample-driven absolute-threshold controller.

The complete source study is [What I learned from PostHog](docs/notes/what-i-learned-from-posthog.md).

## Security, scope, and non-goals

- The console treats every Django staff user as an operator for every team. There is no organization membership model or production RBAC.
- `POST /flags` looks up a raw public project token. Definitions use a secret token whose password hash is stored, but lookup scans teams in this small project.
- There is no person store, identity merge, experience continuity, group evaluation, cohort engine, event ingestion, analytics, experimentation statistics, billing, rate limiting, audit log, or SDK.
- Live evaluation currently reads PostgreSQL through Django. It is not a low-latency horizontally scaled evaluation fleet.
- Definitions use process-local memory caching. There is no Redis, S3, queue, push invalidation, cross-process coherence, or cache-repair worker.
- The rollout controller accepts caller-supplied samples and an absolute threshold. It does not establish causality, compare treatment/control populations, or schedule itself.
- Development defaults, bootstrap credentials, CORS policy, and `ALLOWED_HOSTS` are local-only. A real deployment needs a security and operations design.

## Architecture decisions

1. [ADR-1 — PostHog-compatible hashing and bucketing](docs/adr/0001-posthog-compatible-hashing.md)
2. [ADR-2 — Pure Python evaluation boundary](docs/adr/0002-python-evaluation-boundary.md)
3. [ADR-3 — Definitions polling and ETags](docs/adr/0003-definitions-etag-and-polling.md)
4. [ADR-4 — Health-gated rollout controller](docs/adr/0004-health-gated-rollout-controller.md)
5. [ADR-5 — Identity and caller-supplied properties](docs/adr/0005-identity-and-caller-supplied-properties.md)

Contributor and agent constraints are in [`AGENTS.md`](AGENTS.md).
