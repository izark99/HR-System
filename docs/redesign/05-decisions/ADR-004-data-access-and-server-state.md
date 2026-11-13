# ADR-004 — One data-access layer; no query library

Status: Accepted · 2026-11-13

## Context

AUD-07: Supabase is called from 7 modules; `AdminApi` is a 590-line class mixing five resources;
three error-key helpers exist. Screens load data with a hand-written hook (`useAdminQuery`) and keep
18–28 `useState` each. Start-up JS has 25.4 KiB of budget left. Concurrency is tiny (≤ 6 users, one
admin editing).

## Options

| Option | Bundle | Notes |
|--------|--------|-------|
| A. Keep as is | 0 | Scattered access remains |
| B. `src/api/` with one module per resource + one generic `useResource` hook (generalised from `useAdminQuery`) | ≈ 0 | No cache, no dedupe, explicit `reload()` after writes — matches current behaviour |
| C. `src/api/` + TanStack Query | ≈ +12–13 KiB gzip in start-up JS (estimate, **UNVERIFIED**) | Cache, retries, invalidation; more concepts than this app needs today |

## Decision

**Option B.**

- `src/api/` is the only place that imports the Supabase client. Modules: `users-api`, `groups-api`, `assignments-api`, `flows-api`, `ref-tables-api`, `ui-text-api`, `runs-api`, plus `supabase.ts`, `env.ts`, `client.ts`, `errors.ts`, `database.types.ts`, `flow-source.ts`.
- Each module exports **one class per resource** whose constructor takes a narrowed client type (`Pick<Supabase, …>`, fakeable in tests) — the shape `AdminApi` and `RefTablesApi` already have. `api/client.ts` exports `getApi()`, a lazily built object `{ users, groups, assignments, flows, refTables, uiText, runs }` for app code.
- Every method throws `ApiError { key }`; `api/errors.ts` owns the mapping from Postgres codes / PostgREST / Edge Function results to keys.
- Screens use `useResource(loader, deps?) → { data, error, loading, reload }` from `shared/hooks/use-resource.ts`. Writes call the API method, then `reload()`.

## Consequences

- No new dependency.
- Re-evaluate Option C when any of these becomes true: the same resource is needed by two mounted screens at once; background refresh is required; optimistic updates are required.
- `database.types.ts` stays hand-written but is compared with generated types in T-P0-04 and in the `db-migration` skill.
