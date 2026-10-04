# ADR-2: Evaluation stays pure Python behind an explicit boundary

## Context

Feature-flag management and feature-flag evaluation have different pressures. Management code benefits from Django's ORM, serializers, authentication, and admin tooling. Evaluation benefits from being deterministic, dependency-light, fast to test, and reusable without Django.

PostHog serves production evaluation from a separate Rust service and maintains a cached representation of definitions for that service. Ensaio is a learning project running on one host, not a production-scale clone. Copying that deployment topology would add operational machinery before this project has the traffic or team boundaries that justify it.

## Decision

Ensaio keeps evaluation in the separately packaged `ensaio_kernel` Python package. Production files in that package:

- do not import Django or product code;
- do not perform database, network, cache, clock, or filesystem I/O;
- receive immutable `FlagDefinition` values and caller-supplied properties;
- return immutable `EvaluationResult` values; and
- expose the same function to live evaluation, trace evaluation, tests, and local-definition consumers.

`products/feature_flags/backend/evaluation.py` is the adapter. It copies the small amount of ORM state needed by the kernel into `FlagDefinition`; ORM objects never cross the boundary. `tach check` enforces first-party package directions, while `tach check-external` prevents production kernel files from depending on Django.

The live `POST /flags` endpoint still reads PostgreSQL through Django on each request. Ensaio therefore makes no production throughput or no-database-hot-path claim. Consumers that need request-local evaluation can instead poll `GET /flags/definitions` and evaluate the returned definitions with the kernel, as described in ADR-3.

## Measured cost

`uv run python scripts/bench_eval.py` runs a dependency-free microbenchmark of the pure functions. On the development machine used (Python 3.14.7, macOS 26.6.2, arm64; seven rounds of 100,000 operations after 10,000 warmups), the median results were:

| Operation | Median µs/op | Median ops/s | Min–max µs/op |
| --- | ---: | ---: | ---: |
| `hash_position` | 0.517 | 1,933,703 | 0.499–0.531 |
| `evaluate_boolean_100_percent` | 2.075 | 481,855 | 2.057–2.141 |
| `evaluate_targeted_multivariate` | 6.444 | 155,178 | 6.393–6.532 |

These numbers isolate in-process Python calls. They exclude Django, SQL, serialization, HTTP, concurrency, cache misses, and tail latency, so they are a regression baseline—not a capacity estimate or a Python-versus-Rust comparison.

## PostHog baseline

The following observations are verified against public PostHog
commit `40eeb716559d19325eb82b381663dd07ba9c8020`:

- `products/feature_flags/backend/flags_cache.py` builds a team-scoped `HyperCache` entry stored in Redis and S3. Its `FeatureFlag` post-save and post-delete receivers schedule invalidation with `transaction.on_commit`, preventing a builder from reading pre-commit state.
- The same module currently contains an explicit Kafka cutover. Its `_enqueue_invalidation` selects one primary path: publish a `FlagsCacheInvalidation` message for the Rust builder, or enqueue the Celery task. The paths are intentionally mutually exclusive during that migration.
- `products/feature_flags/backend/flags_cache_messages.py` defines and versions the Python wire contract. Shared fixtures are round-tripped on both the Python and Rust sides so schema drift fails tests.
- `products/feature_flags/backend/tasks.py::update_team_service_flags_cache` rebuilds the service cache through the Python/Celery path.
- `rust/feature-flags/src/bin/flags_cache_builder.rs` consumes invalidations, coalesces them by team, reads fresh database state, and persists rebuilt cache entries. The invalidation is a rebuild trigger rather than the flag payload itself.
- Expiry refresh and verification jobs provide repair paths for stale or missed invalidations.

PostHog's separate local-evaluation definitions cache has additional machinery; ADR-3 records the narrower HTTP polling contract that Ensaio chose.

## Alternatives considered

### Put evaluation methods on Django models

Rejected because it couples a deterministic algorithm to ORM construction and makes local evaluation require Django. Tests would also need more setup for no behavioral benefit.

### Build a separate Rust service now

Rejected for this project's scale. It would help learning about deployment and cross-language contracts, but obscure the evaluation rules behind service plumbing and duplicate types before there is a measured bottleneck.

### Keep a Python service but prebuild a production cache

Reasonable as a future step, but it requires multi-process cache coherence, retries, repair, and observability. M4's definitions endpoint demonstrates the evaluate-locally/sync-asynchronously shape without claiming production cache semantics.

## Consequences

- Evaluation rules are fast to test and reusable outside Django.
- Django remains the source of truth and owns persistence and authorization.
- The explicit adapter makes accidental ORM leakage visible in one place.
- Python is sufficient for the current learning workload, but the live endpoint is not presented as production infrastructure.
- A future service rewrite can preserve the kernel's input/output vectors as the compatibility contract.
- Benchmark changes can reveal regressions, but the script is intentionally not a flaky CI performance gate.
