# ADR-4: Health-gated rollouts use a pure decision function and a command

## Context

A staged rollout should advance only after its guardrail has enough healthy evidence. Missing telemetry is not evidence of health, and a breached guardrail must return the managed release condition to zero without disabling the whole flag or changing unrelated conditions.

This controller is intentionally small: one absolute threshold, one managed `filters.groups` entry, and samples pushed through the management API. It does not compare treatment and control populations or calculate experiment statistics.

## Decision

`products/feature_flags/backend/rollouts.py` contains the pure `decide(plan, samples, now)` state machine. It imports no Django model and reads neither a database nor a clock. The caller supplies immutable state, samples, and `now`; the result is one of `Wait`, `Advance`, `Complete`, `Hold`, `Pause`, or `Revert`.

Rules run in this order:

1. wait for the current phase's minimum duration;
2. keep only samples in the guardrail window whose individual `sample_count` reaches `min_samples`;
3. revert if any evidence sample breaches the absolute threshold;
4. hold when no qualifying evidence exists, then pause after `max_hold_minutes`;
5. otherwise advance, or complete at the final phase.

`python manage.py tick_rollouts` evaluates `ACTIVE` and `HOLDING` plans. Each plan is locked and applied in its own database transaction. The command edits only the configured group's `rollout_percentage`; `FeatureFlag.save()` advances the version and schedules definitions-cache invalidation after commit.

The management API uses `PUT` as an idempotent create-or-replace operation for a flag's optional one-to-one plan. Direct flag API edits that would change the managed percentage return `409 Conflict`, directing the caller to the plan.

## PostHog baseline

PostHog's public `products/feature_flags/backend/models/scheduled_change.py` defines time-triggered feature-flag operations such as status, release-condition, and variant updates. Its public Experiments product calculates and returns experiment analysis through `products/experiments/backend/hogql_queries/experiment_query_runner.py`.

In the public checkout examined for this project, I did not find this exact primitive: automatically advancing a feature-flag percentage from pushed absolute-threshold samples, holding on missing data, and reverting on breach. This is an Ensaio design experiment, not a claim that PostHog lacks other rollout, scheduling, experiment-health, or automation capabilities.

## Alternatives considered

### Celery

Rejected for this version of the project. A periodic Celery task would add a broker, delivery semantics, and worker lifecycle while leaving the important decision logic unchanged.

### Temporal

This is the production-oriented choice for a long-running, retry-heavy, user-facing rollout controller. It is deliberately deferred because Ensaio has one local pass with no remote activities. A future Temporal activity can call the same pure `decide()` function.

### Evaluate directly inside the command

Rejected because time, database access, locking, and policy would become one hard-to-test unit. The pure function earns fast table-driven tests; one Django integration suite proves the transactional effects.

### Treat missing samples as healthy

Rejected. A telemetry outage would then increase exposure precisely when the controller knows least about safety.

### Disable the flag on revert

Rejected. A plan owns one release-condition percentage, not the whole flag. Other conditions can represent staff, allowlists, or independent audiences and must remain untouched.

## Consequences

- phase percentages must be strictly increasing;
- one breaching evidence sample wins over under-sampled data;
- no qualifying data can never advance a rollout;
- `select_for_update` prevents concurrent ticks from applying the same transition twice;
- every percentage change advances `FeatureFlag.version` and invalidates definitions after commit;
- operators run the command manually, with cron, or with `watch`; there is no scheduler service;
- absolute thresholds are simpler but less sensitive than treatment-versus- control guardrails;
- callers are responsible for posting trustworthy samples.
