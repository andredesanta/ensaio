# ADR-6: Agent control plane over the management API

## Context

Ensaio's browser console uses Django sessions and CSRF, while `ens_pub_` and `ens_sec_` credentials authorize evaluation and definitions polling. None is an appropriate autonomous management credential. We also need an MCP boundary whose schemas stay aligned with the HTTP API and whose behavior can be evaluated without giving an agent database access.

## Decision

Introduce project-scoped `ens_pat_` automation tokens. Store a random public selector and a Django password hash of a 256-bit secret; return the raw token only when issued. The token's active user is the actor. Action-aware read/write scopes and the token's team must both authorize every management request. Bearer authentication is composed with existing session authentication so browser and CSRF semantics remain unchanged.

Build an independent TypeScript package under `services/mcp` using the official MCP SDK and stdio transport. It calls Ensaio only through HTTP and never imports Django, backend code, the pure kernel, or database clients. Stdio keeps local client setup small and makes stdout a protocol-only channel.

Keep serializers and OpenAPI as the HTTP source of truth. A strict product-owned `products/feature_flags/mcp/tools.yaml` curates the bounded public agent surface, safety annotations, scopes, allowlists, response projections, and controlled absence behavior. Deterministic generation produces handlers and a committed catalog; drift fails checks.

Expose atomic tools, including dedicated enable, disable, and one-condition rollout actions. Teach the health-gated rollout job in one product skill delivered as an MCP resource and prompt and optionally synchronized to a native client skill directory.

Require optimistic versions for flag and plan mutations. Plan concurrency binds the mutable version to the immutable plan ID to reject delete/recreate ABA races. Any transaction needing both rows locks `FeatureFlag` first and `RolloutPlan` second.

Split evaluation into deterministic contract/probe checks and explicit, credentialed network model runs. Agent runs reset fixtures over REST, record redacted traces, and never fabricate results when a provider is unavailable.

## Consequences

The repository gains a second TypeScript package and lockfile, generated MCP artifacts, token lifecycle commands, concurrency fields, a benchmark, and additional CI. The management API becomes an independently usable product contract. Operators must protect automation tokens and run the rollout ticker separately.

We are intentionally defering delete and scheduler tools, generic request tools, OAuth, hosted transports, Redis state, SQL access, UI apps, billing, and production rate limiting. Those would require stronger confirmation, audit, tenant, and operations designs than this local learning system needs.
