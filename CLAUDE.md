# CLAUDE.md — HR Tools (HR Data Flow Platform)

Internal web app. An Admin configures Excel data flows; a User runs them. **All file content is
processed in the browser** (Web Worker + DuckDB-WASM); the server (Supabase) holds metadata only.
Owner and only maintainer: Harold (HR analytics). Talk to him in Vietnamese.

## Start here

1. **Read `docs/redesign/06-refactor-plan.md` first** — task list, rules, Progress Log (the only project status). Run tasks with the `execute-task` skill, one task per session.
2. Design documents (read only the sections a task cites):

| File | Content |
|------|---------|
| `docs/redesign/00-product-vision.md` | Scope, users, success criteria |
| `docs/redesign/01-current-state-audit.md` | Findings AUD-xx with evidence |
| `docs/redesign/02-target-architecture.md` | Layers, dependency rules, folder tree |
| `docs/redesign/03-domain-and-data-model.md` | Entities, business rules, access matrix |
| `docs/redesign/04-ui-ux-system.md` | Design System v3: tokens, components, pages |
| `docs/redesign/05-decisions/` | ADR-001 … ADR-011 |
| `docs/redesign/07-conventions.md` | Naming, style, API, errors, tests, commits |
| `docs/redesign/08-agent-system.md` | Rules, skills, subagents, hooks |

3. Precedence on conflict: `docs/MEMORY.md` (owner decisions, Vietnamese) > `docs/redesign/` > code > `docs/archive/`. `MEMORY.md` is not auto-loaded: grep it for the topic before changing behaviour in an area.

## Commands

Node ≥ 22, pnpm 10 (`corepack enable`). Run from the repo root.

```bash
pnpm install
pnpm dev                                   # run the app (apps/web)
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build   # required before every commit
pnpm --filter @hrflow/web test excel-reader          # one unit test file (name filter, no "--")
pnpm --filter @hrflow/web build:e2e && npx playwright test e2e/acceptance.spec.ts --trace off   # E2E, selected specs
pnpm --filter @hrflow/web build:e2e && npx playwright test --trace off                           # full E2E
node apps/web/scripts/check-bundle-size.mjs --measure   # bundle sizes after a build
```

E2E always runs on a fresh `build:e2e`, with the pre-installed Chromium (never `playwright install`
locally). A stopped run can leave `vite preview` on port 4173 — stop it before the next run.

## Non-negotiable rules

1. **Data boundary.** File content and HR data never leave the browser: not uploaded, not logged, not stored, not in URLs, not in run logs. No new external origin, CSP change or dependency without the owner's approval.
2. **Behaviour lock.** Engine results do not change during the refactor: the acceptance flow (`fixtures/payroll-timesheet/expected.json`) and the 182 formula golden cases pass unchanged.
3. **Dependency rules** (`02-target-architecture.md` §3): `app → features → shared → api`; `ui` and `engine` stand alone; outside `src/engine` import only `engine/protocol` and `engine/formula/public`; only `src/api` talks to Supabase; no feature imports another feature.
4. **Design system** (`04-ui-ux-system.md`): visual values only in `src/ui/tokens`; screens are composed from `ui` components and page templates; no hand-built table, dialog, popover, file input or page frame.
5. **Never change the design silently.** If a task cannot be done as written, or needs a decision the documents do not make, stop and ask the owner with numbered A/B/C options (one recommended). Record his answer in `docs/MEMORY.md` and update the affected redesign file in the same commit.
6. **Tests.** Never skip or weaken a test to get green. Behavioural E2E assertions are not edited; visual-value assertions and screenshot baselines change only in the task that migrates that screen.
7. **Database.** A released migration is never edited; new tables revoke default grants and enable RLS; RLS / RPC changes are tested on the real database before `main` (skill `db-migration`).
8. **Git.** Never write the owner's company name. No secrets. English Conventional Commits with the task ID. `main` is production and moves only through the `release` skill.
9. **Truthful reports.** Quote the command and its result. Failed or skipped steps are named.

## Stop and ask the owner when

- start-up JS would exceed 240 KiB gzip, or a check fails twice for the same cause;
- SQL with `drop` / `delete` must run on the real database (it cannot go through the MCP connection);
- a request contradicts `docs/MEMORY.md` or a redesign document;
- data in a file, screenshot or message looks real (do not copy it).

## Repository map

```
apps/web/src        app · features · shared · api · ui · engine · locales   (target layout: 02 §4)
packages/flow-schema  Zod schemas of flows, slots, node configs
supabase/           migrations · tests (SQL, begin…rollback) · functions/admin-users
e2e/                Playwright specs, layout-lint, screenshot baselines
fixtures/           fake data only        vendor/  vendored SheetJS (immutable)
docs/               MEMORY.md · redesign/ · archive/
```

## Transition (remove these lines as the tasks complete)

- Until **T-P0-01** is done: `docs/spec.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/design-reference.md` still sit in `docs/`; treat them as `docs/archive/` (reference only; they no longer set priorities).
- Until **T-P0-02** is done: `.claude/rules/*`, `.claude/agents/*` and the `clarify` skill still describe the old process (Vietnamese; they mention `docs/PLAN.md`, `docs/spec.md` and the `developer` agent). Where they conflict with this file or `docs/redesign/`, this file wins. The data-privacy, communication and git rules in them remain valid.
- Until the layout tasks are done, the folders of `02-target-architecture.md` §4 may not exist yet; the Progress Log says which do.
