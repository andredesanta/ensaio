# Contributing to Ensaio

Thank you for considering a contribution. Ensaio is intentionally small enough to learn end to end, and contributions that make its behavior, tests, or explanations clearer are valuable.

You do not need prior experience with feature flags, Django, React, Kea, or MCP. Start with a narrow problem, ask questions in the issue, and use the repository as a guided tour. Familiarity should be the result of contributing, not a prerequisite.

Report security-sensitive findings through the private path in [`SECURITY.md`](SECURITY.md), not a public issue.

## Before choosing work

Ensaio is a learning implementation with a deliberately bounded product scope. The implemented scope is documented by the [`README`](README.md), the [Architecture and production gap register](docs/architecture-and-production-gaps.md), and accepted [ADRs](docs/adr/). Generated OpenAPI/MCP contracts and tests make those claims executable.

Read the [Architecture and production gap register](docs/architecture-and-production-gaps.md) before proposing a production-oriented subsystem. Redis, queues, schedulers, hosted MCP, identity storage, and similar components are absent deliberately. A contribution should not add infrastructure merely because a production system would have it.

Good contributions include:

- A reproducible bug fix with a regression test;
- A clearer error, type, invariant, or boundary;
- Missing coverage for behavior the design already requires;
- Accessibility and usability improvements within existing scenes;
- Documentation that makes a difficult concept easier to learn;
- A deterministic evaluation or contract check;
- A small performance improvement backed by a relevant measurement; and
- A focused proposal that makes an existing trade-off more explicit.

Open an issue before:

- Adding a feature outside the accepted design;
- Adding a runtime dependency or infrastructure service;
- Changing an HTTP, MCP, definition, or evaluation contract;
- Changing a package boundary;
- Altering hashing, bucketing, condition order, identity selection, or rollout semantics; or
- Doing a large refactor.

That early discussion prevents someone from investing in a polished change that cannot fit the project's learning scope.

## Your first contribution

The shortest useful path is:

1. Read the first sections of the [`README`](README.md).
2. Follow the [local setup](#local-setup).
3. Run `./bin/test` once before editing.
4. Choose an unassigned issue labeled `good first issue` or `help wanted`. If none exists, a small documentation clarification or focused regression test is a good first proposal.
5. Comment on the issue with what you plan to change. Ask for clarification instead of guessing at unstated behavior.
6. Make the smallest coherent change, including tests and documentation when behavior changes.
7. Open a draft pull request early if you want feedback on direction.

This follows the documentation-first, start-small approach used by projects such as [Django](https://docs.djangoproject.com/en/5.2/internals/contributing/new-contributors/) and [Zulip](https://github.com/zulip/zulip/blob/main/CONTRIBUTING.md).

## Local setup

### Prerequisites

- Git;
- Docker with Compose;
- [uv](https://docs.astral.sh/uv/);
- Node.js 24 (the exact major is in `.nvmrc`);
- Corepack; and
- Ports 5432, 8000, and 5173 available for the full application.

The project uses uv and pnpm only. Do not install Python dependencies with pip or JavaScript dependencies with npm/yarn.

### Install and verify

From a clone:

```bash
./bin/setup
docker compose up -d
uv run python manage.py migrate
./bin/test
```

`./bin/setup` installs the root Python workspace, frontend package, and independent MCP package. PostgreSQL is the only container used in development.

Create demo data when you want to use the product:

```bash
./bin/bootstrap-demo
./bin/start
```

Then sign in at <http://127.0.0.1:8000/admin/login/> with the documented local credentials and open <http://127.0.0.1:5173/feature_flags>.

Stop application processes with Ctrl+C. Stop PostgreSQL without deleting its volume:

```bash
docker compose stop
```

If setup fails, include the failing command, complete error, operating system, Python version (`uv run python --version`), Node version (`node --version`), and Docker version in your issue. Remove tokens, cookies, `distinct_id` values, and person properties from logs first.

## Find your way around

| Path | Start here when changing |
| --- | --- |
| `packages/ensaio_kernel/` | Hashing, property matching, variants, payloads, reason codes |
| `products/feature_flags/backend/` | Django models, serializers, HTTP APIs, auth, transactions, rollouts |
| `products/feature_flags/frontend/` | Product scenes, Kea logics, generated product client |
| `frontend/` | Vite shell and shared visual primitives |
| `products/feature_flags/mcp/tools.yaml` | Product-owned agent tool selection and safety contract |
| `services/mcp/` | Independent stdio MCP client, generation, validation, evals |
| `docs/adr/` | Accepted architectural decisions |

For a conceptual tour, read:

1. [`README.md`](README.md)
2. [`docs/architecture-and-production-gaps.md`](docs/architecture-and-production-gaps.md)
3. [`docs/notes/what-i-learned-from-posthog.md`](docs/notes/what-i-learned-from-posthog.md)
4. the ADR related to your change
5. [`AGENTS.md`](AGENTS.md) for executable project rules and CI gotchas

## Architectural rules

These rules protect the lessons the project is designed to teach:

1. **The kernel stays pure.** Production files in `ensaio_kernel` do no I/O and import neither Django nor product code.
2. **Django owns effects.** Authentication, tenancy, persistence, locks, transactions, and cache invalidation belong in the backend adapter/service layer.
3. **Policy receives its inputs.** Evaluation and rollout decisions receive definitions, samples, and time instead of reading global state.
4. **Tenant scope precedes lookup.** Never fetch an object globally and check its team afterward.
5. **Lock flag before plan.** Any transaction requiring both locks `FeatureFlag` before `RolloutPlan`.
6. **Generated contracts have one source.** DRF serializers feed OpenAPI; OpenAPI feeds browser and MCP types. Generated files are outputs, not design surfaces.
7. **Kea owns product state.** React renders values and dispatches actions. Feature state and API side effects live in a Kea logic.
8. **MCP is an external consumer.** It uses HTTP and may not import Django, backend, kernel, or PostgreSQL code.
9. **Agent writes are narrow and versioned.** Prefer dedicated actions, read-before-write, optimistic versions, and machine-readable conflicts.
10. **Logs are safe by construction.** Use structured event names and fields. Never log credentials or person data that would be unsafe in a screenshot.

The complete rule set is in [`AGENTS.md`](AGENTS.md). `tach`, Ruff, contract generation, and tests enforce many of these automatically.

## Common change recipes

### Evaluation-kernel behavior

1. Change typed values or pure functions under `packages/ensaio_kernel/src/ensaio_kernel/`.
2. Add the smallest regression test under `packages/ensaio_kernel/tests/`.
3. Add or update a golden vector when server/local conformance is affected.
4. Update ADR-1 or ADR-5 if compatibility or identity semantics change.
5. Run:

```bash
uv run pytest packages/ensaio_kernel/tests
uv run mypy
uv run tach check
uv run tach check-external -e '**/tests/**'
./bin/test
```

Do not weaken a golden vector to accommodate a behavior change without first showing why the previous contract was wrong.

### Django model, serializer, view, or route

1. Add a migration for model changes.
2. Add focused serializer/service tests, then API tests for HTTP semantics.
3. Preserve team-scoped querysets and explicit authentication.
4. Regenerate contracts:

```bash
./bin/generate-schema
cd frontend
corepack pnpm run generate
cd ..
./bin/generate-mcp
./bin/check-mcp
```

Commit the migration, `frontend/openapi.json`, generated API models, Kea types when changed, and generated MCP artifacts in the same pull request. Then run `uv run python manage.py makemigrations --check --dry-run` and `./bin/test`.

Never edit `frontend/openapi.json` or generated TypeScript models by hand.

### React/Kea product behavior

1. Define actions, reducers, selectors, loaders/listeners, or forms in the product logic.
2. Test state transitions and requests at the logic layer.
3. Keep components focused on rendering and user interaction.
4. Use shared UI primitives only for genuinely reusable visual behavior.
5. Regenerate Kea types and format:

```bash
cd frontend
corepack pnpm run generate
corepack pnpm test
corepack pnpm run build
cd ..
./bin/test
```

For user-visible changes, check keyboard operation, focus, labels, error announcements, narrow viewports, loading, empty, and failure states.

### Rollout policy or effects

Policy belongs in `products/feature_flags/backend/rollouts.py`; database work belongs in `rollout_services.py` and `tick_rollouts`.

1. Write a pure decision-table test first.
2. Pass `now`; do not read the clock inside policy.
3. Add a transactional integration test only for locking, persistence, versioning, or cache invalidation.
4. Preserve “missing evidence is not healthy” and mutate only the managed release condition.
5. Run focused rollout tests and then `./bin/test`.

### MCP tool or agent workflow

1. Prefer an existing HTTP operation. Add a dedicated API action before considering generic request capability.
2. Curate the tool in `products/feature_flags/mcp/tools.yaml`.
3. Regenerate in dependency order:

```bash
./bin/generate-schema
cd frontend && corepack pnpm run generate && cd ..
./bin/generate-mcp
./bin/check-mcp
```

After generation:

- add deterministic input, output, absence, error, and protocol coverage;
- Add or update a benchmark task when model behavior should change; and
- Keep paid/networked model evals opt-in—never invent or silently substitute a baseline.

Do not hand-edit `services/mcp/src/tools/generated.ts` or `services/mcp/schema/tool-catalog.json`.

### Documentation-only change

Check every relative link, command, path, and claim against the current tree. Keep procedures chronological and reproducible. Clearly label:

- Observed behavior;
- Public-source PostHog evidence (`[PH-V]`);
- Reasoned inference (`[PH-I]`);
- Local measurements and their environment; and
- Limitations of what a measurement proves.

Documentation-only changes do not require manufacturing a code test, but run the relevant command you document. Run `./bin/test` when the documentation changes contributor workflow, generation order, or architectural rules.

## Tests and quality gates

Use the cheapest test that proves the behavior:

1. Pure function test;
2. Serializer/service test;
3. Django API test;
4. Kea logic test;
5. MCP contract/protocol test;
6. Browser smoke test.

Tests should name the regression they prevent. Do not add a test whose only purpose is executing a line.

The required repository gate is:

```bash
./bin/test
```

It checks Python lint/format/types, first- and third-party boundaries, OpenAPI drift, pytest, frontend types/lint/format/Jest, MCP generation/validation/types/ lint/format/Vitest, and native skill synchronization.

CI additionally regenerates committed artifacts, builds the frontend and MCP server, installs Chromium, and runs the mocked Playwright smoke test. Run those locally for changes they cover:

```bash
cd frontend
corepack pnpm exec playwright install chromium
corepack pnpm run test:smoke
corepack pnpm run build
cd ../services/mcp
corepack pnpm run build
```

Do not “fix” a quality gate by broadening an exclusion or weakening validation unless the pull request explains the lost guarantee and replaces it.

## Branches and commits

Create a focused branch from the current default branch:

```bash
git switch -c fix/short-description
```

Keep a pull request small enough to review as one idea. Separate a preparatory refactor from behavior change when each is useful and testable independently.

Use imperative commit subjects that explain the outcome:

```text
Prevent stale rollout updates
Document definitions cache limits
Add keyboard focus to trace errors
```

There is no requirement to use Conventional Commits. The commit body should explain *why* when the diff cannot.

Never commit:

- `.env` files or credentials;
- Raw `ens_pat_`, `ens_sec_`, or provider tokens;
- Session cookies or person data;
- Dependency directories or build outputs; or
- Real agent-eval traces before checking their redaction.

## Pull requests

A good pull request makes review inexpensive:

- Link the issue and explain the user/problem;
- Describe the approach and important alternatives rejected;
- Identify affected architectural boundaries and production trade-offs;
- Include regression tests or explain why no automated test is useful;
- List exact verification commands and outcomes;
- Include screenshots or a short recording for visible UI changes;
- Commit generated artifacts with their source changes;
- Update docs and ADRs with behavior/decision changes; and
- Keep unrelated cleanup out.

Draft pull requests are welcome for early design feedback. Mark the pull request ready when checks pass, the description is current, and each review comment is resolved or answered.

Review is collaborative, not an exam. Expect questions about correctness, scope, readability, failure modes, and learning value. Reviewers should explain the reason behind requested changes, distinguish blockers from suggestions, and assume good intent. Contributors should ask when feedback is unclear and may disagree with technical reasons.

Do not force-push after review has started unless necessary; preserving the review trail usually makes follow-up easier.

## Reporting bugs

A useful bug report contains:

- The smallest reproduction;
- Expected and actual behavior;
- The exact revision;
- Environment versions;
- Whether the issue is deterministic;
- Relevant redacted logs; and
- A hypothesis only when it is clearly labeled as one.

Please search existing issues first. Do not include secrets or personal data. Use the security policy for vulnerabilities.

## Proposing architecture

For a non-obvious choice, write a short proposal before code:

1. Context and concrete problem;
2. Constraints and non-goals;
3. Proposed decision;
4. Alternatives considered;
5. Consequences and failure modes;
6. How the change is tested and operated; and
7. Which production gap it closes or intentionally leaves open.

Accepted durable choices receive an ADR under `docs/adr/`. Use the next number, state the status, and link code or public evidence precisely. Do not rewrite old ADRs to pretend the original context never existed; supersede them when the decision changes.

## AI-assisted contributions

AI tools are welcome as aids. The human contributor still owns the change:

- Understand and be able to explain every submitted line;
- Verify generated claims, commands, links, and tests;
- Inspect diffs for unrelated or unsafe changes;
- Never provide an assistant with credentials or private person data;
- Disclose material AI assistance when it helps reviewers understand how a large change was produced; and
- Do not submit unreviewed agent output as a contribution.

The standard is the same regardless of tooling: a focused, correct, tested, and maintainable change that the contributor can support.

## Where these practices came from

This guide adapts proven onboarding ideas rather than inventing a ceremony:

- Django: start small, choose work you care about, and include tests/docs;
- Zulip: documentation-first onboarding and early draft feedback;
- GitHub community health guidance: visible contribution, conduct, security, issue, and pull-request guidance; and
- Kubernetes: small pull requests whose descriptions and commits explain the what and why.

The process remains intentionally lighter than those projects because Ensaio has a much smaller scope and contributor community.
