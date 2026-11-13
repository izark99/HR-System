# ADR-011 — Testing strategy during and after the refactor

Status: Accepted · 2026-11-13

## Context

1,348 unit tests, 517 E2E tests (52 flat spec files, 14 of them `*-qa`), 52 screenshot baselines at
0-pixel tolerance, a geometric `layout-lint` (20 rules), axe checks. CI runs everything except E2E
(AUD-22). A refactor that moves files and restyles every screen will touch most UI assertions.

## Decision

| Layer | Rule |
|-------|------|
| Behaviour lock | The engine integration test (`payroll-timesheet.integration.test.ts` vs `fixtures/payroll-timesheet/expected.json`) and `formula-golden.test.ts` (182 cases) must pass unchanged after **every** task. No engine test is edited during the refactor except import paths. |
| Unit tests | Move with their module. Pure logic (`ui/logic/*`, `shared/versioning/*`, `api/errors.ts`, `use-resource`) has unit tests. React components get tests only for logic that cannot live in a pure function. |
| E2E — behaviour | Assertions on text, roles, navigation, downloads, network and storage are **never weakened**. A failing behavioural assertion during a move = a regression to fix. |
| E2E — visual values | Assertions on v2 CSS values and the screenshot baselines are updated to v3 **in the same task** that migrates the screen; the task lists which files. Baselines are regenerated only for the migrated screens and each regenerated image is inspected. |
| `layout-lint` | No rule is deleted or loosened. Pixel constants become reads of the density tokens (T-P3-01). New screens are added to it. |
| Privacy | `e2e/privacy.spec.ts` (no off-origin request, empty storage) runs in every UI task and in CI. |
| Known bugs | `it.fails` / `test.fail` in a "KNOWN BUG" group; never `skip`. |
| Flaky test | Second occurrence → investigate the cause; never raise a threshold. |
| Database | SQL tests in `supabase/tests/` on local Postgres and on the real DB (ADR-010). |
| Independent verification | `verifier` subagent at the end of each phase: reads the diff against the task acceptance criteria, runs the full suite, probes security (data leaving the browser, RLS, CSP), reports correctness gaps only. |
| CI | Adds a smoke E2E job (acceptance, privacy, auth; ≈ 10 tests) in T-P4-03. Full E2E stays local before a merge to `main`. |
| Structure | After the migration, `e2e/` is grouped into `user/`, `admin/`, `designer/`, `engine/`, `ui/`, `support/`; `*-qa` files keep their content and move beside the spec of their area (T-P4-03). |

## Consequences

- The refactor cannot silently change results: S1 in `../00-product-vision.md` is machine-checked.
- UI migration tasks are the largest (baselines + value checks); they are grouped by screen family to regenerate each baseline once.
- Full E2E in CI remains out (cost / time on a free plan); revisit when more than one person merges.
