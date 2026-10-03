# ADR-3: Local-evaluation definitions use polling and ETags

## Context

Server-side consumers should not make a network request for every flag evaluation. Ensaio therefore exposes validated flag definitions that a consumer can cache and pass to the same pure `ensaio_kernel.evaluate()` function.

Definitions reveal targeting rules and payloads, so the public project token used by `POST /flags` is not sufficient authorization. Repeated polling should also avoid retransmitting an unchanged response.

## Decision

`GET /flags/definitions` requires the team's `ens_sec_` bearer token. The raw secret is issued once and only its Django password hash is stored.

The response contains every non-deleted flag, including inactive flags, because a local evaluator needs the inactive definition to return `flag_disabled`. Definitions are cached per team with Django's cache framework.

The ETag is a SHA-256 fingerprint of the team id and the sorted live `(flag id, version)` pairs. A matching `If-None-Match` returns `304 Not Modified`. Responses are `private, must-revalidate` and vary by `Authorization`. Every model save schedules cache invalidation with `transaction.on_commit`, so another request cannot cache data from an uncommitted write.

Consumers poll. Ensaio has no push invalidation, queue, Redis dependency, or background worker.

## PostHog baseline

- `/flags/definitions` is a read-only endpoint for local-evaluation data.
- it authenticates access to team definitions;
- it supports `If-None-Match` and returns `304` on a matching ETag;
- its successful and not-modified responses use `Cache-Control: private, must-revalidate`.

PostHog's production cache, billing, rate limiting, personal-key support, and self-healing machinery are intentionally not reproduced. Ensaio implements the small contract required by its design document.

## Alternatives considered

### Use the public project token

Rejected because definitions expose targeting configuration. A token suitable for client-side evaluation must not grant access to all rules and payloads.

### Store the raw definitions secret for indexed lookup

Rejected because a database disclosure would immediately disclose usable credentials. The small learning project scans teams and calls `check_password`; a larger system would store a non-secret key identifier next to the hash.

### Hash the complete JSON response

This detects every byte-level change but requires serialization before a conditional request can be answered. Flag versions already advance on every model save, so sorted ids and versions are a smaller sufficient fingerprint.

### Push definitions after every write

Rejected for this project current version. Push requires connection lifecycle, retries, fan-out, and backpressure. Polling plus ETags is observable, testable, and fits the project's no-queue constraint.

## Consequences

- unchanged polls transfer no body;
- changing, creating, or soft-deleting a flag changes the relevant snapshot;
- inactive flags remain available to local evaluators;
- team id in the fingerprint prevents cross-team ETag equivalence;
- a consumer can be stale until its next poll;
- LocMemCache is process-local, so this is a development architecture rather than a horizontally scaled cache-invalidation design;
- hashed-secret lookup is deliberately O(number of teams) in this small project.
