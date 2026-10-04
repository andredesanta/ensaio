# Ensaio MCP package

This package is an external client of Ensaio's HTTP API.

- Never import Django, `ensaio_project`, `products.feature_flags.backend`, or `ensaio_kernel`, and never add a PostgreSQL client.
- Keep stdout exclusively for MCP protocol messages. Diagnostics are structured JSON on stderr and must omit tokens, cookies, arguments, person identifiers, properties, payloads, and response bodies.
- Generate tool contracts from `frontend/openapi.json` plus `products/feature_flags/mcp/tools.yaml`. Do not hand-edit `src/tools/generated.ts` or `schema/tool-catalog.json`.
- Never retry mutations. A GET may retry one transient connection failure.
- Model evals require an explicit provider credential and never run in CI.
- Use only `corepack pnpm`; this package owns its independent lockfile.
