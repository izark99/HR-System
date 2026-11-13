# 00 — Product Vision

> Status: approved direction (owner answers 2026-11-13: 1B, 2A, 3ABCD, 4A, 5C, 6B, 7 = refactor + rebuild agent system).
> Product name in the UI: **HR Tools**. Repository name: HR Data Flow Platform.

## Problem

HR analysts repeat the same Excel work every period: reconcile two exports, merge branch files, clean
columns, build a monthly summary. The work is manual, error-prone and cannot be handed to a
colleague. HR files contain personal and payroll data, so uploading them to a cloud tool is not
acceptable.

## Product

A web app where an **Admin** configures a data flow once (visual DAG: Excel inputs → transforms →
compare → Excel output) and a **User** runs it: choose flow → enter parameters → pick files → check →
run → preview → download. **All file content is processed inside the browser** (Web Worker +
DuckDB-WASM). The server stores only accounts, flow configuration, reference tables without personal
data, and run metadata.

## Target users (next 6 months)

| Role | Who | Count | Main job |
|------|-----|-------|----------|
| Admin | The owner (HR analytics, IT background) | 1 | Build, version and publish flows; manage accounts and reference tables |
| User | Up to 5 trial colleagues | ≤ 5 | Run assigned flows and download results |

No third role. No self sign-up.

## Core use cases (ranked)

1. **Run a published flow** on local Excel files and download the result (User).
2. **Build or change a flow** in the Designer without editing JSON, preview each node on sample files (Admin).
3. **Version a flow by effective date**: draft → publish → retire, run "as of" a past period (Admin).
4. **Maintain reference tables** (code lists, rates) with effective dates and use them in flows (Admin).
5. **Manage access**: accounts, groups, flow assignments (Admin).
6. **See what ran**: run history and audit trail without any file content (Admin).

## In scope

- Browser-only processing of `.xlsx` / `.xls`, up to ~1,000,000 rows × 30 columns per run.
- Node types: `input.excel`, 8 transforms, `transform.formula` (41 Excel functions → SQL), `code.sql`, `control.compare`, `output.excel`, `output.preview`.
- Flow and reference-table versioning by effective date; immutable published versions.
- Admin screens: flows, versions, Designer, reference tables, users / groups / assignments, UI text overrides.
- One shared design system (DS v3) used by every screen; Vietnamese UI with i18n structure.
- This redesign: architecture boundaries, data-access layer, DS v3, agent system, ops safety. **No change to engine behaviour.**

## Out of scope

- Storing employee, payroll, headcount or budget data on the server (decision 2A; `docs/MEMORY.md` 2026-10-26 08:20).
- Dashboards over stored HR data, a third role, SSO / 2FA, public sign-up.
- Dark mode, English UI, CSV input, Python node (`code.python`) — until the owner asks.
- New infrastructure: no extra backend service, queue, or paid tier. Hosting stays Cloudflare Pages + Supabase Free.
- Company IT / legal compliance work (owner decision 2026-11-12 21:09: personal experiment). Compliance flags are listed in `03-domain-and-data-model.md` §9 for information only.

## Success criteria

| # | Criterion | Measured by |
|---|-----------|-------------|
| S1 | Refactor finishes with **identical results**: acceptance flow output and 182 formula golden cases unchanged | `pnpm test` (payroll-timesheet integration + formula-golden) |
| S2 | No cross-feature import and no engine-internal import from the UI | `pnpm lint` (zone rules, `02-target-architecture.md` §3) |
| S3 | Every screen uses only `ui/` components and DS v3 tokens; `components/` and v2 tokens deleted | `ds-v3.test.ts`, folder absent |
| S4 | A new admin list screen is built from existing `ui/` parts with **0 new CSS values** and ≤ 150 lines of screen code | Check on the first screen built after the refactor |
| S5 | Adding a node type touches a fixed, test-enforced list of files | `node-coverage.test.ts` |
| S6 | RLS tests and one restore-verified backup have run green on the real database; repo is private | Progress Log entry with run links |
| S7 | Product goals carried over from the old plan: ≥ 3 published flows of different kinds; owner builds a 5–8 node flow in ≤ 30 min; ≥ 10 real runs in 30 days | `flow_versions`, owner timing, `run_logs` |

## Assumptions and open questions

| ID | Type | Statement |
|----|------|-----------|
| A-00-1 | ASSUMPTION | "Refactor first": feature work (reference tables round 2, `output.template`) resumes after phase P4. The owner's answer to question 7 did not pick an order explicitly. |
| A-00-2 | ASSUMPTION | S7 targets are unchanged from the archived plan (`docs/archive/PLAN.md` §1). |
| Q-00-1 | OPEN QUESTION | Which concrete visual traits of the current UI does the owner dislike (answer 3C)? DS v3 changes structure, density and scale; palette hue and typeface are kept as swappable theme values until the owner says otherwise (`04-ui-ux-system.md` §12). |
