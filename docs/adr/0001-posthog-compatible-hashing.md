# ADR-1: Hashing and bucketing are PostHog-compatible

## Context

Ensaio's interoperability claim is deliberately narrow: once a condition qualifies, the same flag key, `distinct_id`, rollout percentage, and variant weights produce the same stable bucket assignment as PostHog. A different hash would still be deterministic, but moving a definition between the systems would reshuffle users. That would make even this scoped compatibility claim false and make a rollout unsafe to compare.

This decision was verified against the public PostHog checkout at commit `40eeb716559d19325eb82b381663dd07ba9c8020`.

## Decision

Ensaio uses the v1 PostHog bucketing contract:

1. Hash the UTF-8 bytes of `prefix + identifier + salt` with SHA-1.
2. Interpret the first 15 hexadecimal digits (60 bits) as an integer.
3. Divide by `0xfffffffffffffff`, producing a position in `[0, 1]`.
4. For a normal flag, use `f"{flag_key}."` as the prefix and `distinct_id` as the identifier.
5. When the selected identifier is empty, return `0.0` without hashing.
6. Use an empty salt for rollout and `"variant"` for variant selection.
7. Include a subject when `position <= rollout_percentage / 100`.
8. At exactly 100%, return included without computing a hash.
9. Select variants in definition order. Add each percentage to a cumulative boundary and select the first variant for which `position < cumulative`.
10. Leave the subject without a variant when weights total less than 100 and the position falls in the remainder.

Conditions are evaluated in stored list order and the first complete match wins. A later condition with a pinned variant does not move ahead of an earlier matching condition. If no condition matches, `out_of_rollout_bound` outranks `no_condition_match`.

M1 hashes only the caller's `distinct_id`. Group keys, device bucketing, and experience-continuity `hash_key_override` selection are outside this project version contract and are documented in ADR-5 rather than silently approximated.

## PostHog baseline

- `rust/feature-flags/src/flags/flag_matching_utils.rs`, `calculate_hash`: SHA-1, first 60 bits, and `LONG_SCALE = 0xfffffffffffffff`.
- The same file's `test_calculate_hash` supplies the published values `0.7270002403585725` for `holdout-some_distinct_id` and `0.4493881716040236` for `holdout-test-identifier`. Ensaio also checks the other two vectors in that test.
- `rust/feature-flags/src/flags/v1_bucketing.rs`, `is_in_rollout`: the 100% shortcut and inclusive `<=` rollout comparison.
- `rust/feature-flags/src/flags/v1_bucketing.rs`, `select_variant`: strict `<` cumulative variant boundary and unassigned underweight remainder.
- `rust/feature-flags/src/flags/flag_matching.rs`, `get_hash`: normal prefix `f"{flag.key}."`, empty rollout salt, `"variant"` variant salt, and the `0.0` sentinel for an empty selected identifier.
- The same file's `hashed_identifier` selects a group key for group aggregation; otherwise a non-empty device id wins when device bucketing is configured, followed by the experience-continuity override chain and finally `distinct_id`. ADR-5 records that identity policy and the narrower Ensaio boundary in detail.
- The same file's `get_match` enumerates conditions without sorting and returns on the first match. `test_condition_evaluation_order_with_variant_overrides` pins this behavior explicitly.
- `rust/feature-flags/src/flags/flag_match_reason.rs`, `FeatureFlagMatchReason::score`: `OutOfRolloutBound` has score 3 and `NoConditionMatch` score 2.

## Alternatives considered

### SHA-256 or a shorter integer bucket

Both are reasonable for a new flag system but would reshuffle every assignment. Cryptographic strength is not the requirement; compatibility and stable distribution are.

### A half-open rollout interval

Using `<` for rollout may look mathematically tidy, but PostHog uses `<=`. Changing one boundary violates the stated contract even though exact boundary hits are rare.

### Normalizing percentages into exactly 100%

This would assign users that PostHog intentionally leaves unassigned when the weights are incomplete. Ensaio preserves the remainder.

### Sorting pinned-variant conditions first

That changes first-match behavior. The current PostHog Rust evaluator and its regression test preserve list order, so Ensaio does too.

## Consequences

- Raising a rollout percentage only adds subjects; it does not reshuffle those already included.
- Rollout and variant assignment are independent because they use different salts.
- Definition order is behavior. Reordering conditions or variants can change results and must be treated as a real flag edit.
- SHA-1 is kept for compatibility, not selected as a new security primitive.
- Golden vectors and direct Rust hash vectors make accidental changes to any comparator, salt, prefix, or scale fail in CI.
- Property matching has its own explicitly tested Ensaio subset. In particular, it fails closed when a value-requiring property is missing, including negative operators, and implements person-level `in`/`not_in` even though PostHog's Rust v1 matcher reserves those operators for cohort membership. Ensaio also emits `flag_disabled` inside its kernel, while PostHog filters inactive flags before calling the v1 matcher. The compatibility claim in this ADR is about hashing and bucketing, not complete matcher parity.
