# Ensaio documentation

Use this page to choose the shortest reading path.

## I want to use the project

1. [Root README](../README.md) — capabilities and 60-second setup
2. [Generated OpenAPI contract](../frontend/openapi.json) — management and evaluation HTTP schema
3. [Agent eval guide](../services/mcp/evals/README.md) — MCP probes, benchmark, and real-model runner
4. [Security policy](../SECURITY.md) — supported context and private reporting

## I want to understand the architecture

1. [Architecture and production gap register](architecture-and-production-gaps.md) — boundaries, request flows, deliberate shortcuts, and production directions
2. [ADR-1: Hashing and bucketing](adr/0001-posthog-compatible-hashing.md)
3. [ADR-2: Pure evaluation boundary](adr/0002-python-evaluation-boundary.md)
4. [ADR-3: Definitions polling and ETags](adr/0003-definitions-etag-and-polling.md)
5. [ADR-4: Health-gated rollout controller](adr/0004-health-gated-rollout-controller.md)
6. [ADR-5: Identity boundary](adr/0005-identity-and-caller-supplied-properties.md)
7. [ADR-6: Agent control plane](adr/0006-agent-control-plane.md)

## I want to compare Ensaio with PostHog

1. [README comparison](../README.md#posthog-and-ensaio-same-ideas-different-goals)
2. [What I learned from PostHog](notes/what-i-learned-from-posthog.md)

## I want to contribute

1. [Contributing guide](../CONTRIBUTING.md)
2. [Agent and contributor constraints](../AGENTS.md)

The README and ADRs define accepted product scope. The production gap register explains what is deliberately *not* a production design. `CONTRIBUTING.md` explains the current workflow.

## Documentation rules

- Link code and evidence precisely.
- Separate observed behavior from inference.
- Never imply the microbenchmark is a load or capacity test.
- Never imply a deterministic probe is a real model evaluation.
- Keep local credentials visibly local.
- Update the production gap register when a shortcut or scale boundary moves.
- Add or supersede an ADR when a non-obvious decision changes.
- Run every command you add to a guide.
