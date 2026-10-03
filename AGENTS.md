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
products/feature_flags/     one product: backend/ (Django app), frontend/, manifest.tsx
ensaio_project/             settings, root URLs
frontend/                   Vite shell. Product UI does not go here

The Django app label is `feature_flags`, not `backend`. The Python path is
`products.feature_flags.backend`, and the default label would collide with the next product.

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
