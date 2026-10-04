# Ensaio MCP evals

The `m7-v1` benchmark is the objective function for the agent control plane. Its twelve tasks own isolated `mcp-eval-` fixtures, which are reset through the REST API before every trial. The system under test (MCP) never seeds itself. Use a dedicated empty Ensaio project: the seeder fails closed when it finds a live flag whose key does not begin `mcp-eval-`, preventing unrelated project data from reaching a model or baseline artifact.

Deterministic validation runs in `./bin/test`. With PostgreSQL, Django, a write-scoped automation token, and the built MCP package running locally:

```bash
export ENSAIO_BASE_URL=http://127.0.0.1:8000
export ENSAIO_PROJECT_ID=1
export ENSAIO_API_TOKEN=ens_pat_FAKE_REPLACE_ME

cd services/mcp
corepack pnpm run build
corepack pnpm run eval:probe -- --output /tmp/ensaio-m7-probes.json
```

Probe mode mechanically refuses mutating tools. It checks discovery, schema, execution, errors, and latency; it does not test model tool choice.

Agent mode uses the pinned OpenAI adapter and requires both an actual provider credential and an explicit model. It starts a fresh MCP client and model conversation after each fixture reset:

```bash
export OPENAI_API_KEY=...
export ENSAIO_EVAL_MODEL=...
./bin/run-agent-evals \
  --output docs/agent-evals/m7-baseline.json \
  --repetitions 3 \
  --skill resource
```

The default full run executes every task three times, then the rollout task once with tools only for the skill comparison. Use `--task <id>` only while debugging. A publishable run also requires a committed, clean Git tree. The runner fails before creating an artifact when credentials, model, Git state, server configuration, or the output path are missing. It never simulates an agent, changes models, or fabricates baseline results.

Review traces before publication. They retain tool names, redacted arguments, and controlled success/error metadata—not API tokens, person properties, payloads, or full tool responses. The JSON records Git commit, package-derived MCP SDK version, fixed generation settings, reset validity, model, date, skill delivery, and repetitions. Write and review the companion human interpretation before publishing it. A baseline is evidence, not a CI gate or a production quality claim.
