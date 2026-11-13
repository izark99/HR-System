# ADR-003 — Module layers and enforced dependency rules

Status: Accepted · 2026-11-13

## Context

AUD-04, 05, 06: boundaries are good by habit but not enforced; 23 cross-feature import edges; the
UI reaches into 9 engine-internal modules; shared code lives inside feature folders
(`runner/engine-client`, `auth/idle/activity`, `runner/as-of`).

## Options

| Option | Notes |
|--------|-------|
| A. Keep folders, document rules only | Zero cost; drift continues |
| B. Layers `app → features → shared → api`, `ui` standalone, engine behind two public modules; enforced with ESLint built-in `no-restricted-imports` per folder | No new dependency; rules visible in one file |
| C. Same layers enforced with `eslint-plugin-boundaries` or `dependency-cruiser` | Richer reports; one more dev dependency and config language |
| D. Split into more workspace packages (`@hrflow/ui`, `@hrflow/engine`, `@hrflow/api`) | Hard boundaries by package; heavy for one developer; complicates Vite worker / chunking and the bundle check |

## Decision

**Option B.** Layers and matrix as in `../02-target-architecture.md` §2–§3. Engine public surface =
`engine/protocol.ts` + `engine/formula/public.ts`. Feature = top-level folder under
`src/features/`. Zones are added as ESLint **errors**: engine purity and public surface first
(T-P0-05), all zones after the moves (T-P1-05).

## Consequences

- Each ESLint zone is one config object matching one folder, because a later `no-restricted-imports` entry replaces an earlier one for the same file.
- Files move (`lib/` → `api/` + `shared/`; cross-feature modules → `shared/`); imports are relative (no path alias is introduced).
- `designer` no longer imports `admin`; both use `api/flows-api` and `shared/versioning`.
- Option D stays available later; nothing here blocks it.
