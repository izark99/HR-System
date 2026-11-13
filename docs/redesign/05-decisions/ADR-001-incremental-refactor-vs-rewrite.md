# ADR-001 — Incremental refactor, not a rewrite

Status: Accepted · 2026-11-13

## Context

The owner described the project as messy and asked for a redesign. The audit
(`../01-current-state-audit.md`) found: all checks green; 1,348 unit tests and 517 E2E tests;
strict TypeScript with 0 `any`; a clean engine ↔ UI direction; RLS on every table. The real
problems are structural drift (AUD-04…09, 11…15), ops gaps (AUD-01…03), document and agent sprawl
(AUD-24, 25), and low usage (AUD-30). The engine (12,274 lines plus 15,970 lines of tests: streaming xlsx, zip-bomb limits,
formula transpiler with 182 golden cases checked against real Excel, DuckDB integration) is the
most expensive and best-tested part.

## Options

| Option | Cost | Risk | Result |
|--------|------|------|--------|
| A. Rewrite the app | Very high: ≈ 40k lines + 40k lines of tests | Re-introduces solved bugs (zip bomb took 5 rounds; decimal and Unicode key rules); no usable app for weeks | Clean slate, same features |
| B. Rewrite the UI only, keep engine + backend | High: 26,519 lines of UI code + all 517 E2E tests | E2E tests are bound to visible text and roles; a rewrite invalidates most of them at once | New UI |
| C. Incremental refactor (strangler): new `ui/`, `api/`, `shared/` beside the old folders, screens migrated one group at a time, old folders deleted last | Medium, spread over ≈ 30 tasks; app shippable after every task | Temporary duplication (two token sets, two component folders); needs discipline to finish | Same features, new structure |

## Decision

**Option C.** The engine, `packages/flow-schema`, the database schema and the Edge Function are not
rewritten and not behaviourally changed. The UI layer is restructured and restyled by migration,
not by rewrite: component logic (`select-logic`, `menu-logic`, `calendar`, `tabs-logic`,
`toast-store`, `run-store`, Designer `model.ts`) is moved, not re-implemented.

## Consequences

- Every task ends with `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; UI tasks also with E2E for the touched area.
- Two token sets and two component folders coexist from T-P2-01 to T-P3-08. The CSS budget is raised for that window (ADR-005).
- Honest downside: the Designer keeps React Flow and its current interaction model; the workspace problems (AUD-19) are only partly addressed here (`SplitPane`) and continue in the product backlog.
- A rewrite is reconsidered only if a phase fails its acceptance criteria twice.
