# Architecture and production gap register

This document explains Ensaio's architecture at two levels:

1. What the code does today; and
2. Which choices are intentionally appropriate for a small learning project but are not a production design.

The distinction is part of the design, not a disclaimer added after the fact. Ensaio keeps the behavior under study—deterministic evaluation, contract generation, concurrency, transactional rollout effects, and agent safety—while leaving out infrastructure whose main lesson would be operating it.

The [`README`](../README.md) states the implemented feature scope. ADRs explain individual decisions, while generated contracts and tests make behavior executable. This page is the cross-cutting architecture map.

## System shape

```text
                                management plane
 browser ── session + CSRF ──▶ Django/DRF ───────────────▶ PostgreSQL
 agent ── stdio MCP ── HTTP ─▶     │                           │
                                   │ ORM → immutable value     │ definitions
                                   ▼                           ▼
                              ensaio_kernel            GET /flags/definitions
                                   ▲                    secret + ETag
                                   │
 application ── POST /flags ───────┘

 tick_rollouts ──▶ pure decide(plan, samples, now)
                 └─▶ lock flag, lock plan, apply one transition
```

The important boundaries are:

- `packages/ensaio_kernel/` owns deterministic evaluation and performs no I/O;
- `products/feature_flags/backend/` owns persistence, authentication, transactions, HTTP, and conversion between ORM and kernel values;
- `products/feature_flags/frontend/` owns feature UI and Kea state;
- `frontend/` is only the Vite shell and shared visual primitives;
- `services/mcp/` is an external HTTP client, not an in-process privileged adapter; and
- serializers generate OpenAPI, which generates browser and MCP contracts.

[`tach.toml`](../tach.toml), Ruff rules, generation-drift checks, and tests make these boundaries executable.

## Request and state flows

### Manage a flag

1. A browser session or project-scoped automation token reaches the DRF management API.
2. `TeamScopedViewSetMixin` scopes the queryset before object lookup, so a foreign-project ID is a 404.
3. A mutation presents the last observed `version`.
4. The view locks the flag row, rejects a stale version with 409, validates the serializer, and saves.
5. `FeatureFlag.save()` advances the version.
6. Definitions-cache invalidation is registered with `transaction.on_commit`, so an uncommitted definition is never published.

Relevant code:

- `products/feature_flags/backend/views.py`
- `products/feature_flags/backend/serializers.py`
- `products/feature_flags/backend/models.py`
- `products/feature_flags/backend/definitions_cache.py`

### Evaluate a flag

`POST /flags/?v=2` resolves the team from its public project token, reads all active flags from PostgreSQL, copies each ORM row into an immutable `FlagDefinition`, and calls `ensaio_kernel.evaluate()`.

A trusted server-side consumer can instead poll `GET /flags/definitions` with a hashed secret credential and an ETag, cache the response, and call the same kernel locally. That path demonstrates “synchronize definitions, evaluate near the caller” without shipping a production SDK.

Relevant code:

- `products/feature_flags/backend/public_views.py`
- `products/feature_flags/backend/evaluation.py`
- `products/feature_flags/backend/definitions.py`
- `packages/ensaio_kernel/src/ensaio_kernel/`

### Advance a rollout

The rollout state machine in `backend/rollouts.py` is pure: its inputs include `now`, plan state, and samples. It returns a decision without reading a clock or database. `backend/rollout_services.py` owns effects. It locks `FeatureFlag` before `RolloutPlan`, computes one decision, and mutates only the release condition owned by the plan.

This separation keeps policy exhaustively testable while preserving a realistic transactional seam.

### Let an agent operate the product

The MCP server loads a product-curated catalog generated from OpenAPI plus `products/feature_flags/mcp/tools.yaml`. It validates model-supplied input, calls the same management HTTP API as any external client, validates projected output, and returns protocol-safe errors. It cannot import Django, the ORM, or the kernel.

Automation tokens contain a public selector and a password-hashed secret. Their project and action-aware scopes constrain every request. Flag and rollout mutations require optimistic concurrency tokens; the agent must read before it writes and reconsider a 409.

Relevant code:

- `products/feature_flags/backend/agent_authentication.py`
- `products/feature_flags/mcp/tools.yaml`
- `services/mcp/scripts/generate-tools.ts`
- `services/mcp/src/`
- `services/mcp/evals/`

## Production gap register

“Production direction” is an architectural direction, not a backlog promise. A real implementation would validate each choice against measured traffic, availability targets, threat models, data residency, and team ownership.

### Runtime and deployment

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| Django `runserver` and Vite run on the host; Compose runs only PostgreSQL (`bin/start`, `docker-compose.yml`) | Fast edit/reload loop and almost no container ceremony | No TLS termination, process supervision, rolling deployment, horizontal scaling, or static-asset serving plan | Build immutable artifacts; run Django behind a production server and proxy; define health, readiness, shutdown, migration, and rollback procedures |
| `DEBUG` defaults on, the secret key and database credentials have obvious local defaults, and hosts/CORS are localhost-only (`ensaio_project/settings.py`) | A clone starts without secret provisioning | Unsafe and non-functional as a hosted configuration | Split settings by environment; fail closed on missing secrets; use a secret manager; configure secure cookies, TLS, hosts, CORS, CSP, and proxy headers |
| PostgreSQL is one local container with a named volume | Preserves real SQL, constraints, and row locks without an operations platform | No backups, replication, failover, connection pool, point-in-time recovery, capacity policy, or migration orchestration | Use a managed or operated HA PostgreSQL deployment with pooling, backup/restore drills, observability, and migration runbooks |

### Evaluation and definition propagation

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| `POST /flags` reads all active project flags from PostgreSQL on every request and evaluates in Django (`backend/public_views.py`) | The complete path is visible in one process and shares the tested kernel | Database and Python web capacity sit directly on the latency-sensitive hot path; cost grows with flags × requests | Separate management from evaluation serving; prebuild compact project snapshots; serve from a cache-first fleet; measure p50/p95/p99 and degraded behavior |
| The definitions cache is Django `LocMemCache` (`settings.py`, `backend/definitions.py`) | Zero infrastructure and deterministic tests | Every process has a different cache; invalidation affects only the current process; restarts discard it | Use shared durable cache tiers plus versioned invalidation, retries, expiry refresh, and repair/verification jobs |
| Writes schedule local invalidation after commit | Preserves the important transaction ordering lesson | No cross-process delivery, fan-out, backpressure, replay, or missed-message repair | Publish a versioned invalidation after commit; let builders read canonical state; make consumers idempotent and observable |
| Consumers poll definitions with ETags | Cheap unchanged requests and simple failure semantics | Freshness depends on poll interval; no fleet-wide staleness SLO or SDK lifecycle | Ship supported SDKs, define polling/backoff/jitter, expose snapshot age, and add push only if measured freshness needs justify its complexity |
| The evaluator is pure Python | Easy to read, test, package, and reuse | The microbenchmark excludes HTTP, SQL, concurrency, and tail latency; it is not a capacity result | Keep golden vectors as a language-neutral contract; move the hot path only after profiling justifies another runtime or topology |

### Tenancy, identity, and authorization

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| Every Django staff user may operate every team; the URL and queryset still scope data (`products/feature_flags/backend/views.py`) | Teaches tenant-safe lookups without building an organization product | No membership, role, invitation, service-account, or least-privilege model for people | Model organizations, projects, memberships, roles, and explicit authorization policy; test object and list isolation |
| The console hard-codes team `1` in `frontend/index.html` | Avoids building a project switcher before there is a membership model | Cannot represent a multi-project user and must never be treated as authorization | Resolve the active project from authenticated state and a server-authorized project list |
| Evaluation receives a caller-supplied `distinct_id` and properties | Keeps the kernel deterministic and free of hidden I/O | No person history, identity merge, groups, cohorts, privacy lifecycle, or anonymous-to-identified continuity | Design identity selection separately from hashing; specify retention/deletion and how local evaluation receives continuity data |
| Definitions-secret lookup scans every team and checks each password hash (`backend/definitions.py`) | Raw secrets are not stored and the data set is tiny | Deliberately O(number of teams), with an expensive password hash per candidate | Store a non-secret indexed selector beside the hash, as automation tokens already do; rate-limit failures and support rotation/audit |
| Public project tokens are stored in lookup form | Mirrors a client-distributed identifier rather than pretending it is a secret | Anyone holding one can call the public evaluation surface; abuse controls are absent | Treat it as public, minimize granted capability, and add quotas, rate limits, abuse detection, and key rotation |

### Rollout automation

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| Operators run `tick_rollouts` manually, from `watch`, or cron | The policy and transactional effect are testable without a workflow platform | No durable scheduling, ownership lease, retries, alerting, missed-tick recovery, or operator UI | Run the same pure decision function from a durable workflow/scheduler with idempotent activities and explicit retry/alert policy |
| Callers push absolute-threshold samples | Makes missing/healthy/breached semantics concrete | The service does not establish provenance, deduplicate measurements, query telemetry, or compare treatment and control | Integrate a trusted metric pipeline; version metric definitions; account for delay, gaps, deduplication, and statistical uncertainty |
| One plan owns one condition percentage | Ownership is narrow enough to prevent unrelated flag damage | No concurrent controllers, dependencies, overlap analysis, approval policy, or fleet-wide admission control | Add explicit ownership/leases, audit history, conflict detection, approvals where warranted, and safe cancellation/recovery |
| Row locks serialize a flag and its plan | Correct for one PostgreSQL primary and modest contention | Long work or many due plans can create lock contention; one-by-one ticking is not a high-throughput scheduler | Claim bounded batches, keep transactions short, distribute work with idempotency, and monitor lock wait/throughput |

### Frontend and API contracts

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| Three product scenes cover list, edit, and trace | Small enough to understand end to end | No accessibility audit, localization, large-list strategy, comprehensive browser matrix, or design system governance | Add accessibility tests and manual review, pagination/search backed by the API, i18n, error monitoring, and supported-browser policy |
| Serializer → OpenAPI → generated TypeScript/MCP is the contract chain | Prevents hand-written types from silently drifting | Generation alone does not provide compatibility versioning or deprecation policy | Add API lifecycle policy, compatibility tests, schema diff review, deprecation windows, and consumer telemetry |
| Optimistic versions guard mutations | Prevents silent stale writes and is especially useful for agents | No idempotency keys for creates, offline conflict UX, or distributed workflow reconciliation | Add operation-specific idempotency and conflict-resolution UX where retries can duplicate effects |

### Agent control plane and evals

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| MCP is local stdio with configuration in process environment | Official protocol with a small trust boundary and no hosted auth service | No remote transport, OAuth, session store, user consent flow, tenant routing, hosted isolation, or service SLO | Design hosted authentication and authorization first; isolate tenants; rate-limit; audit; define confirmation policy and regional topology |
| Twelve product-curated atomic tools; no generic request, SQL, delete, or project-switch tool | Least capability is easier to reason about and evaluate | A broader product needs discoverability, lifecycle/versioning, and policy across many products | Preserve product ownership and explicit allowlists; add tools only with contract, safety annotation, and eval coverage |
| Read-only transport failures may retry once; mutations never retry automatically | Avoids duplicate writes without requiring every endpoint to be idempotent | A hosted service needs a complete retry, timeout, circuit-breaker, and overload policy | Add endpoint-aware idempotency and bounded retries; export latency/error/retry metrics without exposing credentials or person data |
| Deterministic probes run in CI; real model evals are opt-in | CI is stable, cheap, and credential-free; unavailable providers never produce fake evidence | No checked-in cross-model baseline or release threshold; model/provider drift is not monitored | Run isolated, budgeted evals with pinned model/settings, reviewed fixtures, trend history, and explicit release criteria |

### Operations, security, and governance

| Current choice | Why it works here | Where it stops scaling | Production direction |
| --- | --- | --- | --- |
| Structured logs cover requests and MCP calls | Establishes safe event-shaped logging and redaction habits | No metrics, tracing backend, dashboards, alerting, retention, or incident process | Define service-level indicators, traces, redaction policy, dashboards, alerts, runbooks, and incident review |
| Bootstrap creates known local credentials | Makes the demo reproducible | Those credentials must never exist outside local development | Disable bootstrap paths in deployed environments and provision identities through an audited administrative path |
| Soft deletion is a boolean on flags | Preserves keys and hides deleted rows simply | No retention, purge, restore, legal-hold, or dependent-data policy | Define lifecycle jobs, restore windows, referential cleanup, and audit events |
| CI uses a mocked Playwright journey | Fast, deterministic coverage of the critical UI flow | It does not prove a deployed browser/backend/database system works together | Keep the mocked smoke test, then add a small real-stack acceptance suite and deployment smoke checks at the appropriate layer |

## Deliberately retained production habits

Small does not mean careless. These choices are worth retaining in a larger system:

- Tenant scoping happens in the queryset, not after object retrieval;
- Secrets are returned once and password-hashed at rest;
- Automation tokens use indexed non-secret selectors and narrow scopes;
- Browser session authentication retains CSRF protection;
- Flag and rollout writes use explicit optimistic concurrency;
- Transactions use a consistent flag-before-plan lock order;
- Cache invalidation is scheduled after commit;
- Policy functions receive time and data rather than reading global state;
- The evaluation kernel has no framework or I/O dependency;
- Generated contracts are checked for drift;
- Agent tools use the ordinary API instead of bypassing authorization;
- MCP stdout is protocol-only and diagnostics redact credentials/person data; and
- Performance and agent-eval evidence is labeled with what it does not prove.

## Decision index

- [ADR-1: PostHog-compatible hashing and bucketing](adr/0001-posthog-compatible-hashing.md)
- [ADR-2: Pure Python evaluation boundary](adr/0002-python-evaluation-boundary.md)
- [ADR-3: Definitions polling and ETags](adr/0003-definitions-etag-and-polling.md)
- [ADR-4: Health-gated rollout controller](adr/0004-health-gated-rollout-controller.md)
- [ADR-5: Caller-supplied identity](adr/0005-identity-and-caller-supplied-properties.md)
- [ADR-6: Agent control plane](adr/0006-agent-control-plane.md)

When a contribution changes one of these boundaries or materially changes a row in the production gap register, update this document and add or amend an ADR.
