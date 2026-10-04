# ADR-5: Identity is caller supplied and continuity is out of scope

## Context

A deterministic flag assignment is only stable while the hashed identifier is stable. Real products must answer harder identity questions: which person properties are authoritative, whether to bucket a device or a logged-in user, how groups are identified, and what happens when an anonymous visitor becomes an identified person.

Ensaio has no person, distinct-ID, group, or identity-merge store. Pretending that `distinct_id` alone solves anonymous-to-identified continuity would hide an important systems problem.

## Decision

Every Ensaio evaluation request supplies:

- one non-empty `distinct_id`; and
- a map of person properties used only for that evaluation.

The pure kernel hashes exactly that `distinct_id`. It does not look up or persist people, merge identities, select a group key, accept a device bucketing mode, or read a hash-key override. The `type: "person"` field in a filter means “compare against the request's property map,” not “query a person database.”

The caller owns identifier stability. If an application evaluates an anonymous visitor as `anon-123` and later evaluates the same human as `user-456`, Ensaio may assign a different rollout bucket or variant. That is an explicit limitation for this project version.

Properties affect eligibility but never the hash input. Changing `country` or `plan` may make another condition eligible; it does not reshuffle an otherwise unchanged `distinct_id`.

## PostHog baseline

In `rust/feature-flags/src/flags/flag_matching.rs::hashed_identifier`:

1. For group-based evaluation, PostHog resolves the aggregation's group-type name, reads that name from the request's `groups` map, and hashes the group key. String keys remain strings and numeric keys are converted to strings. Missing keys and non-string/non-number JSON values become the empty string.
2. For person-based evaluation configured for device bucketing, a present, non-empty `device_id` wins.
3. Otherwise, only when the flag currently enables experience continuity, the priority is a database-sourced override for that flag key, then the request's anonymous-ID override, then `distinct_id`.
4. When continuity is off, stale stored overrides are deliberately ignored and `distinct_id` is used.

`get_hash` then passes the selected identifier to `calculate_hash(f"{flag.key}.", identifier, salt)`. Its empty-identifier compatibility behavior is `0.0`.

PostHog migration `posthog/migrations/1152_fix_device_bucketing_persist_across_auth.py` treats `bucketing_identifier="device_id"` together with `ensure_experience_continuity=True` as invalid. It disables continuity on existing rows with that combination. Because the bulk update bypasses model signals, the migration explicitly schedules cache invalidation after the outer transaction commits.

PostHog selects an identity according to aggregation, device mode, and continuity policy before applying the same key/salt hash primitive. Ensaio implements only the final person `distinct_id` branch.

## A possible future Ensaio design

If identity continuity becomes a real requirement, it should be added as an explicit versioned contract rather than hidden in `evaluate()`:

1. extend the request with separate `distinct_id`, optional `device_id`, optional `anonymous_id`, and group keys;
2. add a typed bucketing policy to each flag;
3. isolate identifier selection in a pure `select_hash_identifier()` function;
4. persist continuity mappings in a team- and flag-scoped store with clear merge, deletion, and retention semantics;
5. keep the selected identifier out of logs and traces unless it is safe to expose;
6. add cross-implementation vectors before claiming PostHog compatibility; and
7. define how local evaluation receives continuity data without a synchronous identity-store lookup.

The last point is the architectural constraint: live evaluation can consult a service-side identity store, while fully local SDK evaluation cannot assume that store is available. A production design must choose what data moves to the caller and what compatibility it can honestly preserve.

## Alternatives considered

### Hash all properties with the ID

Rejected because ordinary profile edits would reshuffle assignments and make progressive rollouts unsafe.

### Infer continuity when two requests share properties

Rejected because matching on email or another property is identity resolution, not feature-flag evaluation. It creates privacy, correctness, and deletion obligations far beyond this project.

### Accept an untyped `hash_key_override` now

Rejected because it would expose a powerful compatibility mechanism without specifying who may set it, how it persists, or how local and live evaluation stay consistent.

## Consequences

- Ensaio's identity model is small enough to explain and test completely.
- Callers can evaluate hypothetical properties without creating database rows.
- There is no server-side person history, cohort membership, group evaluation, or anonymous-to-identified continuity.
- Changing the caller's `distinct_id` can change both rollout inclusion and variant assignment.
- Ensaio's PostHog-compatibility claim remains scoped to hashing and bucketing once a `distinct_id` has already been selected.
