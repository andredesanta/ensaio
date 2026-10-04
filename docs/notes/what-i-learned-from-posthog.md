# What I learned from PostHog while building Ensaio

Ensaio is an independent learning project. I am not claiming that its small implementation is equivalent to PostHog, and none of these notes came from private company information. I verified them against the public [`PostHog/posthog`](https://github.com/PostHog/posthog) repository at commit [`40eeb716`](https://github.com/PostHog/posthog/tree/40eeb716559d19325eb82b381663dd07ba9c8020).

## 1. Compatibility lives in unglamorous boundary details

Before reading the evaluator, I thought “deterministic rollout” mostly meant choosing SHA-1 and formatting a string. The source showed me that compatibility also depends on taking exactly the first 15 hex digits, dividing by the exact scale, using an inclusive rollout boundary, using a strict variant boundary, preserving list order, and leaving the underweight variant remainder unassigned.

The relevant source is [`rust/feature-flags/src/flags/flag_matching_utils.rs`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/rust/feature-flags/src/flags/flag_matching_utils.rs), [`rust/feature-flags/src/flags/v1_bucketing.rs`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/rust/feature-flags/src/flags/v1_bucketing.rs), and [`rust/feature-flags/src/flags/flag_matching.rs`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/rust/feature-flags/src/flags/flag_matching.rs). The condition loop in `get_match` returns the first complete match in stored order; the regression test named `test_condition_evaluation_order_with_variant_overrides` confirms that a later pinned variant is not promoted.

This changed how I implemented Ensaio: I wrote golden vectors and tests for comparators, salts, condition order, and incomplete weights rather than testing only that results looked roughly distributed. ADR-1 contains the resulting hashing and condition-order contract; ADR-5 records the identity-selection part.

## 2. Identity selection is a separate algorithm from hashing

The most important identity lesson was that the evaluator does not blindly hash `distinct_id`. In `rust/feature-flags/src/flags/flag_matching.rs::hashed_identifier`, a group-based flag uses the request's group key; person evaluation can prefer a non-empty device id; and experience continuity can prefer a stored per-flag override or the request's anonymous id before falling back to `distinct_id`.

The migration [`posthog/migrations/1152_fix_device_bucketing_persist_across_auth.py`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/posthog/migrations/1152_fix_device_bucketing_persist_across_auth.py) makes the product consequence concrete: PostHog treats device bucketing plus experience continuity as an invalid combination and disables continuity for existing affected flags. Because its bulk update skips Django signals, the migration schedules cache invalidation explicitly after commit.

Ensaio has no identity store, so I chose a much smaller honest contract: callers supply `distinct_id` and properties, and only `distinct_id` is hashed. Anonymous-to-identified continuity and group bucketing remain unsolved rather than approximated. ADR-5 records the trade-off.

## 3. A JSON API contract includes casing, omission, and failure shape

Reading a Rust struct is not enough unless I also read its serde attributes and tests. In [`rust/feature-flags/src/api/types.rs`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/rust/feature-flags/src/api/types.rs), `FlagsResponse` uses `#[serde(rename_all = "camelCase")]`, so the v2 root emits `errorsWhileComputingFlags`, `flags`, optional `quotaLimited`, `requestId`, `evaluatedAt`, and optional `minimalFlagCalledEvents`, plus flattened config fields. Its tests assert the camel-cased keys, and integration tests under `rust/feature-flags/tests/test_flags.rs` exercise real response bodies.

Each flag's detailed value is also a contract: `key`, `enabled`, optional `variant`, an omitted-unless-true `failed`, `reason`, `metadata`, and optional condition analysis. That made me avoid casually converting every Python field name to snake case or copying a legacy `/decide` response shape.

Ensaio implements only the subset: `flags` and `errorsWhileComputingFlags` at the root, with a smaller per-flag object. The OpenAPI document is generated from DRF serializers, and the TypeScript API types are generated from OpenAPI.

## 4. “A model was saved” is not the same as “evaluators can see it”

PostHog's write path taught me to trace configuration propagation all the way to the runtime reader. In [`products/feature_flags/backend/flags_cache.py`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/products/feature_flags/backend/flags_cache.py), feature-flag save/delete signals register an invalidation with `transaction.on_commit`, so a builder cannot race ahead and publish uncommitted state.

At the checked commit, that module is in a documented transition: it routes a team to either Kafka or Celery as the primary cache writer. The versioned message lives in [`products/feature_flags/backend/flags_cache_messages.py`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/products/feature_flags/backend/flags_cache_messages.py); the Celery rebuild is `products/feature_flags/backend/tasks.py::update_team_service_flags_cache`; and the Kafka consumer is [`rust/feature-flags/src/bin/flags_cache_builder.rs`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/rust/feature-flags/src/bin/flags_cache_builder.rs). The message says which team changed; the builder reads fresh state instead of trusting a definition embedded in the event.

Ensaio's LocMem cache is intentionally much smaller, but it preserves the transactional lesson: model saves schedule definitions-cache invalidation on commit. Polling clients use ETags and can be stale until their next poll. ADR-2 and ADR-3 state the scale difference explicitly.

## 5. Safe rollout automation starts by defining what missing evidence means

PostHog already has substantial adjacent functionality. Public [`products/feature_flags/backend/models/scheduled_change.py`](https://github.com/PostHog/posthog/blob/40eeb716559d19325eb82b381663dd07ba9c8020/products/feature_flags/backend/models/scheduled_change.py) models time-triggered status, release-condition, and variant changes, including recurrence. Public experiment query code, including `products/experiments/backend/hogql_queries/experiment_query_runner.py`, calculates experiment analyses.

Within those named areas and the feature-flags product at the checked commit, I did not find Ensaio's exact M5 primitive: advance one release-condition percentage from caller-pushed absolute-threshold samples, hold when qualifying samples are missing, pause after a maximum hold, and revert that percentage on a breach. This is a statement about my scoped search, not a claim that PostHog has no guardrails, workflows, or rollout automation.

The design lesson was still useful. “No data” must not silently mean “healthy,” and a controller should mutate only the part of a flag that it owns. Ensaio's pure decision function therefore holds or pauses on insufficient evidence and reverts only its managed condition. ADR-4 records the precise difference.
