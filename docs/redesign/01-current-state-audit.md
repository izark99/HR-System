# 01 — Current State Audit

> Audited commit: `7103d18` (branch = `origin/main`), 2026-11-13. Read-only.
> Paths are relative to the repo root; `src/` means `apps/web/src/`.
> "Addressed by" refers to tasks in `06-refactor-plan.md` or ADRs in `05-decisions/`.

## 1. Verified commands

| Command | Result (this audit) |
|---------|---------------------|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm format:check` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0 — 1,348 passed (web 1,300 + flow-schema 33 + functions 15), 4 expected-fail, 12 skipped |
| `pnpm build` | exit 0 — start-up JS 214.6 KiB gzip (limit 240.0); CSS 38.5 KiB gzip (limit 40.5) |
| `pnpm --filter @hrflow/web build:e2e` | exit 0 |
| `npx playwright test e2e/acceptance.spec.ts e2e/privacy.spec.ts e2e/auth.spec.ts --trace off` | 10 passed |
| Full `pnpm test:e2e` (517 tests in 52 spec files, `npx playwright test --list`) | **UNVERIFIED** in this audit (last recorded green: `docs/HANDOFF.md` §1) |

Production database (Supabase project in `apps/web/.env.example`, read-only check): 12 public tables,
RLS enabled on 12/12, row counts: profiles 2, flows 2, flow_versions 3, flow_assignments 1,
run_logs 3, audit_logs 129, ui_text_overrides 105, ref_tables 1, ref_table_versions 1, groups 0.

## 2. Architecture as implemented

```
Browser
  React 19 SPA (TanStack Router, Tailwind v4)        src/app, src/features, src/components, src/lib
    └─ Comlink ─► Web Worker: engine                  src/engine (core, io, duckdb, formula, nodes)
                   reads .xlsx/.xls, validates, runs the DAG (TS + DuckDB-WASM), writes .xlsx
Supabase (metadata only)                              supabase/migrations (6 files), supabase/functions/admin-users
  Auth, Postgres + RLS + RPC, 1 Edge Function
Cloudflare Pages (static hosting, CSP in apps/web/public/_headers)
GitHub Actions: ci.yml, keep-alive.yml, backup.yml, db-tests.yml
```

- Workspace: `apps/web`, `packages/flow-schema` (Zod schemas), `supabase/functions` (pnpm workspace).
- Size: 39,767 lines of app code, 22,507 lines of unit tests, 18,065 lines of E2E code.
- State: no state library. React context for auth (`src/features/auth/auth-context.tsx`), run session (`src/features/runner/run-store.ts`), toasts; local `useState` in pages; Designer history inside `DesignerEditor.tsx`.
- Server access: Supabase client called from 7 modules (`admin-api.ts`, `ref-tables-api.ts`, `ui-text-api.ts`, `auth-service.ts`, `supabase-flow-source.ts`, `lib/ui-text.ts`, `app/services.ts`).

## 3. Strengths to preserve (not findings)

| Item | Evidence |
|------|----------|
| File content never leaves the browser; engine has no DOM, `no-console` lint | `eslint.config.js` (engine block), `e2e/privacy.spec.ts`, `apps/web/public/_headers` |
| RLS on every table; client refuses a service-role key | `supabase/migrations/20261026080100_rls.sql`, `src/lib/env.ts` |
| Edge Function checks origin, bearer token, admin role, active flag, Zod input | `supabase/functions/admin-users/handler.ts` lines 334–356 |
| Run log holds metadata only (hashed file names, error **keys**) | `supabase/migrations/20261026080000_core_schema.sql` (`run_logs`), `src/features/runner/run-log.ts` |
| No secret in git history (pattern scan; one match is a throwaway CI scratch DB URL) | `.github/workflows/backup.yml` line 63 |
| 0 `any`, 0 `@ts-ignore`, 0 TODO; strict TS | grep over `src/` |
| Engine → UI direction is clean (1 exception, AUD-04) | grep of imports |
| Bundle budget and heavy-library placement enforced at build | `apps/web/scripts/check-bundle-size.mjs`, `apps/web/bundle-budget.json` |

## 4. Findings

Severity: **High** = data-safety or recovery risk; **Medium** = slows every future change or causes drift; **Low** = local smell.

| ID | Finding | Evidence | Sev | Addressed by |
|----|---------|----------|-----|--------------|
| AUD-01 | Migration history table on the real DB is empty: all 6 migrations were applied with ad-hoc SQL. Schema drift cannot be detected by tooling. | Supabase `list_migrations` → `[]`; `docs/HANDOFF.md` §3 | High | T-P0-04, ADR-010 |
| AUD-02 | `supabase/tests/rls.sql` and `versions.sql` have never run on the real DB; no backup has ever run. | `docs/HANDOFF.md` §3; `docs/PLAN.md` §4 M0.1–M0.2 | High | T-P0-03 |
| AUD-03 | Repo is public and contains operating notes (project ref, first admin username, list of unverified areas). | `docs/PLAN.md` §8.5, `docs/HANDOFF.md` §2 | Medium | T-P0-03 |
| AUD-04 | UI imports engine internals, not only the protocol: `engine/design`, `engine/formula/{compile,functions,parser,refs}`, `engine/io/{validation,ref-import}`, `engine/preview`, `engine/worker`; 4 of them are value imports. Engine imports `lib/text-vars`. | 21 import lines under `src/features/**`; `src/engine/core/i18n.ts` line 5 | Medium | T-P0-05, ADR-003 |
| AUD-05 | Module boundaries are convention only; ESLint has no import-zone rule. | `eslint.config.js` | Medium | T-P1-05 |
| AUD-06 | Cross-feature coupling: 23 import edges. `designer → admin` (`admin-api`, `use-admin`, `versions/FlowVersionsPage`), `admin/designer/auth → runner` (`engine-client`, `as-of`, `components/ParamsCard`), `admin → auth` (`auth-context`, `credentials`), `runner → auth` (`idle/activity`). | grep of `from '../<feature>/…'` in `src/features` | Medium | T-P1-01, T-P1-02 |
| AUD-07 | Data access is scattered: `AdminApi` is one 590-line class (users, groups, flows, versions, assignments, publish); `profiles` is queried from 4 modules; 3 different error-key helpers. | `src/features/admin/admin-api.ts`, `ref-tables/ref-tables-api.ts`, `ui-text/ui-text-api.ts`, `auth/auth-service.ts` | Medium | T-P1-01, T-P1-03, ADR-004 |
| AUD-08 | Oversized UI files mixing data loading, dialogs and tables: `AdminUsersPage.tsx` 1,003 lines / 13 components / 28 `useState`; `DesignerEditor.tsx` 1,075 lines / 1 component; `NodeForms.tsx` 1,079 lines / 14 forms; `FlowVersionsPage.tsx` 895; `RefTableVersionsPage.tsx` 810; `AdminFlowsPage.tsx` 671; `UiTextPage.tsx` 621. | `wc -l`, grep of `function [A-Z]` and `useState` | Medium | T-P3-03…07, T-P4-01 |
| AUD-09 | Version lifecycle UI is written twice: `PublishForm` + `EndDateForm` exist in both versions pages (≈ 280 lines each) with identical RPC shapes. | `FlowVersionsPage.tsx` lines 612–895; `RefTableVersionsPage.tsx` lines 531–810; RPC signatures in `20261027080000_designer_versions.sql`, `20261109150000_ref_tables.sql` | Medium | T-P3-04, ADR-007 |
| AUD-10 | Version lifecycle SQL is written twice (two guard triggers, two publish RPCs). | `private.flow_versions_guard`, `private.ref_table_versions_guard` | Low | ADR-007 (accepted; not changed) |
| AUD-11 | Adding a node type edits ≥ 6 places with no single completeness check: schema, engine plugin + registry, Designer catalog, form map, issue text, locale. | `packages/flow-schema/src/transforms.ts`, `src/engine/nodes/index.ts`, `src/features/designer/catalog.ts`, `forms/NodeForms.tsx` (`FORMS`), `issue-text.ts`, `locales/vi/designer.json` | Medium | T-P3-07, T-P4-02, ADR-006 |
| AUD-12 | Six separate floating-layer positioning implementations. | `getBoundingClientRect` in `src/components/{Select,Tooltip,Menu,InfoTip,picker-shared,FormField}.tsx` | Medium | T-P2-05, T-P2-06 |
| AUD-13 | Nine hand-built `<table>` / grid implementations outside the shared `DataTable`. | `src/features/runner/components/{ResultTable,ValidationReport}.tsx`, `designer/DataPanel.tsx`, `designer/formula/FormulaForm.tsx`, `admin/versions/DiffView.tsx`, `admin/ref-tables/{DataGrid,RowDiffView,ImportDialog}.tsx`, `components/ui.tsx` | Medium | T-P2-09 |
| AUD-14 | Four raw `<input type="file">` with different wrappers (one shows the browser's English text). | `AdminFlowsPage.tsx:529`, `ref-tables/ImportDialog.tsx:194`, `runner/components/SlotCard.tsx:112`, `designer/DataPanel.tsx:320` | Low | T-P2-04 |
| AUD-15 | Design tokens are a single flat tier (`teal-strong`, `ink`, `coral-tint`…) with no semantic layer; density is handled by exceptions (`text-dense`, `denseInputClass`, `denseThClass`, 14 `FRAME_ALLOW` entries); `components/ui.tsx` exports raw class strings (`cardClass`, `inputClass`, `thClass`, `tdClass`…) that features compose by hand. | `src/index.css` (`@theme`), `src/components/ui.tsx`, `src/components/__tests__/design-tokens.test.ts` (`FRAME_ALLOW`) | Medium | T-P2-01…09, ADR-005 |
| AUD-16 | 15 type styles including an off-grid 14.4 px; 4 font weights (8 woff2 files) loaded. | `src/index.css` lines 9–110, `--text-button-sm` | Low | T-P2-01 |
| AUD-17 | Admin menu shows 3 unbuilt entries (dashboard, templates, logs); their label is truncated on production. | `src/features/admin/AdminLayout.tsx` (`ITEMS`), `docs/PLAN.md` §7 | Medium | T-P3-03 |
| AUD-18 | Result screen for a flow without `control.compare` shows only a "done" title. **UNVERIFIED in code** (source: `docs/PLAN.md` §4 M4). | — | Low | Backlog B-05 |
| AUD-19 | Designer workspace is cramped at 1280/1024 (canvas ≈ 230 px high with the data panel open; node text small). **UNVERIFIED visually** (source: `docs/HANDOFF.md` §4.12c, `docs/PLAN.md` §7). | — | Medium | T-P2-08 (`SplitPane`), T-P3-07 |
| AUD-20 | `en` locale has 27 of 1,732 keys. | `src/locales/en/*.json` | Low | Out of scope (00) |
| AUD-21 | All E2E tests mock Supabase (1,629 lines of mock); the client ↔ real DB contract is not tested automatically; `database.types.ts` is hand-written. | `e2e/supabase-mock.ts`, `e2e/supabase-mock-ref.ts`, `src/lib/database.types.ts` header | Medium | T-P0-03, T-P0-04 |
| AUD-22 | CI runs lint, typecheck, unit tests, build; no E2E. | `.github/workflows/ci.yml` | Low | T-P4-03 |
| AUD-23 | 14 `*-qa.spec.ts` files overlap the main spec of the same area; 52 spec files in one flat folder. | `ls e2e/` | Low | T-P4-03 |
| AUD-24 | Six overlapping instruction layers with stale facts: `docs/HANDOFF.md` §2 says 9 tables / 4 migrations (actual 12 / 6) and "~1170 tests" (actual 1,348); `docs/spec.md` §19 lists `engine/python/`, `supabase/seed.sql` (do not exist); `docs/spec.md` §26–34 are per-round acceptance criteria, not specification. | Files named | Medium | T-P0-01, ADR-008 |
| AUD-25 | Agent setup works against current Claude Code guidance: `CLAUDE.md` imports the 356-line `docs/MEMORY.md` into every session; 6 rule files load always; zero-exception rules (protected files, verifier may only write tests) are prompt-only; no `.claude/settings.json`, no hooks. | `CLAUDE.md`, `.claude/rules/*`, `.claude/agents/*` | Medium | T-P0-02, ADR-009 |
| AUD-26 | Supabase security advisor: "Leaked password protection disabled" (WARN); 2 `SECURITY DEFINER` functions callable by `authenticated` (intended, self-checking). | advisor output 2026-11-13; `20261026080200_rpc.sql` (`my_recent_runs`, `purge_run_logs`) | Low | T-P0-03 (first); second accepted |
| AUD-27 | `e2e/layout-lint.ts` hardcodes `CONTROL_H = 44`, `SMALL_H = 36`. | `e2e/layout-lint.ts` lines 503–504 | Low | T-P3-01 |
| AUD-28 | `components/KpiCard.tsx` imports `lib/format` (UI kit depends on app utilities). | `src/components/KpiCard.tsx` line 2 | Low | T-P2-09 |
| AUD-29 | `ui_text_overrides` holds 105 rows that now equal the built-in defaults. | DB row count; `docs/PLAN.md` §8.6 | Low | T-P0-03 |
| AUD-30 | Product is barely used (2 accounts, 3 runs); most past effort went to UI polish. | DB row counts; `docs/HANDOFF.md` §6 | Medium | 00 (S7), Backlog |
| AUD-31 | Known engine MINOR items remain open (timezone ISO cell, Unicode key edge cases, slow DEFLATE edge file, 50-column formula planning). | `docs/HANDOFF.md` §4.2, §4.4, §4.6, §4.7 | Low | Backlog B-07 (unchanged by this refactor) |

## 5. Feature inventory

| Area | Feature | State |
|------|---------|-------|
| User | Sign in, forced password change, idle sign-out (8 h) | Working |
| User | Flow list + recent runs, run wizard, validation report, result (KPI, tables, download) | Working |
| Admin | Users, groups, flow assignments (one page) | Working |
| Admin | Flows list, JSON import, create flow | Working |
| Admin | Versions: publish, retire, end date, rollback, diff | Working |
| Admin | Flow Designer (canvas, 13 node forms, preview, keyboard connect) | Working; workspace cramped (AUD-19) |
| Admin | UI text overrides | Working |
| Admin | Reference tables: definition, versions, grid edit, Excel import | Working, **not usable from flows** (no `input.refTable`) |
| Admin | Dashboard, Templates, Logs | Not built (menu placeholders) |
| Engine | 13 node plugins; DuckDB-WASM; streaming xlsx read/write; zip-bomb limits | Working |
| Engine | `input.refTable`, `output.template`, `output.chart`, `code.python` | Not built |
| Ops | CI, keep-alive | Working |
| Ops | Weekly backup, DB tests on real DB | Workflows exist, never run (AUD-02) |

## 6. Assumptions and open questions

| ID | Type | Statement |
|----|------|-----------|
| A-01-1 | ASSUMPTION | Line counts and line numbers are for commit `7103d18`; tasks identify code by symbol name, not by line. |
| Q-01-1 | OPEN QUESTION | AUD-18 and AUD-19 were not re-verified on screen in this audit; the executor confirms them in T-P3-02 / T-P3-07 before acting. |
