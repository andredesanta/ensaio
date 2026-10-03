# Ensaio — agent and contributor notes

Ensaio is a learning project: a small feature-flag platform shaped like PostHog's. It is not affiliated with PostHog or with any employer.

## Stack

| Layer | Use |
| --- | --- |
| Python | 3.13+ (`.python-version` is 3.14). **uv** only. `uv sync`, then `uv run`. No pip, no Poetry |
| API | Django ~5.2, Django REST framework ~3.17, drf-spectacular |
| DB | PostgreSQL 15, `docker compose up` (the compose file is Postgres only) |
| Boundaries | **tach**. `ensaio_kernel` must not import Django or do I/O |
| Frontend | React 18, TypeScript, Kea, Tailwind 4, Vite, **pnpm** 10.29.3 |
| Lint | Ruff (line length 120, Black-compatible formatter), Oxlint, Oxfmt |

## Layout

```text
packages/ensaio_kernel/     pure evaluation. no Django or I/O
products/feature_flags/     CRUD/trace, console, evaluation + definitions
ensaio_project/             settings, root URLs
frontend/                   Vite shell. Product UI does not go here

The Django app label is `feature_flags`, not `backend`. The Python path is `products.feature_flags.backend`, and the default label would collide with the next product.

## Commands to run before you finish

```bash
./bin/test
```

That is: `ruff check`, `ruff format --check`, `mypy`, `tach check`, `tach check-external`, OpenAPI drift, `pytest`, `tsc --noEmit`, `oxlint`, `oxfmt --check`, `jest`.

Day to day: `./bin/setup` once, `./bin/start` to boot Postgres, Django on port 8000, and the console on port 5173.

After changing a serializer or Kea logic, regenerate frontend artifacts:

```bash
./bin/generate-schema
cd frontend && corepack pnpm run generate
```

## Rules

- Never hand-write a TypeScript interface that mirrors a Django serializer. Serializers are the source of truth. Generate types with orval from the OpenAPI schema. Do not edit generated files by hand.
- Regenerate `frontend/openapi.json` with `./bin/generate-schema` after changing a serializer, view, or route. Do not edit it by hand.
- Feature state lives in a Kea logic. React renders it. `useState` / `useEffect` are for ephemeral visual state inside `frontend/src/lib/ui/` only.
- Named exports only. Explicit return types on new TypeScript functions.
- Python is written as if `mypy --strict` is on. Log with structlog: an event name plus fields, never a sentence, and never a token or a `distinct_id` you would not put in a screenshot.
- Tests name the regression they prevent. Prefer a pure function over a Django test, and a Django test over a browser test. Do not add a test whose only point is that a line ran.
- `packages/ensaio_kernel` imports nothing from `ensaio_project`, `products`, or Django. `tach check-external` enforces the Django ban (`cannot_depend_on_external` in `tach.toml`). `tach check` enforces first-party boundaries. Do not "just this once" import the ORM into the kernel.

## CI gotchas

- Backend CI starts PostgreSQL 15 for model and API tests. Every database test must still opt into pytest-django with `django_db` or the `db` fixture. `/healthz` deliberately remains database-free liveness.
- Definitions cache invalidation is scheduled with `transaction.on_commit`. Tests that need callbacks to run immediately use `django_db(transaction=True)` or explicitly execute captured callbacks.
- `uv sync --frozen` fails if `uv.lock` is stale. Run `uv lock` and commit the lockfile.
- Frontend CI uses `pnpm install --frozen-lockfile`. Commit `frontend/pnpm-lock.yaml`.
- Frontend CI reruns orval, kea-typegen, and Oxfmt, then requires a clean `git diff`. Generated API models and `*LogicType.ts` files must be committed.
- Playwright's smoke test uses mocked API routes, but CI must still install Chromium with `pnpm exec playwright install --with-deps chromium`.
- `tach` with `exact = true` fails if `depends_on` lists a module nobody imports yet. Add the dependency in the same change as the import.
- `tach` 0.29.0 segfaults while parsing config on CPython 3.14. The pin is `~=0.35.0`. If a tool crashes at startup, suspect the wheel before suspecting the config. The design doc's fallback is Python 3.13; we did not need it.
- The Django ban on the kernel is `tach check-external`, not `tach check`. `tach check` only sees first-party imports. The kernel is a separate distribution, so Django is external to it.
- `tach check-external` excludes `**/tests/**`: pytest and Hypothesis belong to the root development group, not the kernel's zero-dependency runtime contract. Production package files remain checked.
