# 06 — Refactor Plan

> **Read this file first in every execution session** (skill `execute-task`).
> Baseline: commit `7103d18`. `src/` means `apps/web/src/`. All commands run from the repo root.
> Follow tasks literally. If a step cannot be done as written or needs a decision that is not here,
> stop and ask the owner — never redesign silently.

## 1. Ground rules

| Rule | Detail |
|------|--------|
| Order | Tasks run in the order of §3, respecting `Depends`. One task per session. |
| App stays shippable | Every task ends with the verification of its row green and a pushed commit. |
| Behaviour lock | Engine results must not change. `V-LOCK` runs in every task that touches `src/`. |
| No scope growth | No feature, no dependency, no CSP change, no schema change unless the task says so. |
| Moves | A move is `git mv` in its own commit with only import-path edits; content changes come in a later commit. |
| Tests | Behavioural assertions are never weakened (ADR-011). Engine tests change import paths only. |
| Stop and ask | Start-up JS would exceed 240 KiB; a check fails twice for the same cause; a task needs `drop`/`delete` SQL on the real DB; anything contradicts `docs/MEMORY.md`. |
| Sizes | S ≤ ½ session, M ≈ 1 session, L = 1 long session → delegate to `implementer`. |

### Verification macros

| Macro | Command |
|-------|---------|
| `V-BASE` | `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` |
| `V-LOCK` | `pnpm --filter @hrflow/web test payroll-timesheet formula-golden` → 2 files, 188 tests pass (count at baseline); `git status --short fixtures/` prints nothing |
| `V-E2E <specs>` | `pnpm --filter @hrflow/web build:e2e && npx playwright test <specs> --trace off` |
| `V-E2E-FULL` | `pnpm --filter @hrflow/web build:e2e && npx playwright test --trace off` |
| `V-SAFE` | `V-E2E e2e/privacy.spec.ts e2e/acceptance.spec.ts e2e/auth.spec.ts` (paths change after T-P4-03) |
| `V-BUDGET` | In `pnpm build` output: line `bundle-budget: OK start-up JS … (limit 240.0 KiB …)`; record the number |

Default rollback for every task: `git revert` the task's commits (no data is touched unless the task says so).

## 2. Task format

`ID · Title · Size · Depends` — then Goal, Files, Steps, Acceptance criteria (AC), Verify, Rollback.

---

## 3. Phases and tasks

## P0 — Governance and safety net

Ends with: one design source, new agent system, real-DB checks green, engine public surface enforced. No app behaviour change.

### T-P0-01 · Archive legacy documents · S · Depends: —

**Goal.** `docs/redesign/` is the only design source (ADR-008).

**Files.** Move: `docs/spec.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/design-reference.md`, `docs/patches/` → `docs/archive/`. Create: `docs/archive/README.md`. Change: `README.md`, `scripts/db-tests.sh`, `scripts/backup/dump-and-verify.sh`, `CLAUDE.md`.

**Steps.**
1. `mkdir -p docs/archive && git mv docs/spec.md docs/PLAN.md docs/HANDOFF.md docs/design-reference.md docs/patches docs/archive/`.
2. Create `docs/archive/README.md` with exactly: a title "Archive (frozen)", and three sentences: these files are kept for reference only; `spec.md` §8–§14, §24, §25.4, §27, §34 remain the behaviour reference cited by `docs/redesign/03-domain-and-data-model.md`; nothing here is edited — new decisions go to `docs/MEMORY.md` and `docs/redesign/`.
3. `README.md`: replace every link to `docs/PLAN.md` and `docs/HANDOFF.md` with `docs/redesign/06-refactor-plan.md`; replace links to `docs/spec.md` with `docs/redesign/02-target-architecture.md`; in the folder-structure block replace the `docs/` lines with the `docs/` lines of `02-target-architecture.md` §4.
4. In the two scripts, change the comment text `docs/PLAN.md M0.1` / `docs/PLAN.md M0.2` to `docs/redesign/06-refactor-plan.md T-P0-03` (comment only).
5. `CLAUDE.md`: delete the bullet about legacy documents in the "Transition" section.

**AC.** (a) `ls docs` = `MEMORY-archive.md MEMORY.md archive redesign`. (b) `grep -rnE "docs/(spec|PLAN|HANDOFF|design-reference)\.md" README.md scripts .github CLAUDE.md apps packages supabase e2e` → no output. (c) `git log --follow docs/archive/spec.md` shows the old history.

**Verify.** `V-BASE`.

### T-P0-02 · Rebuild the agent system · M · Depends: T-P0-01

**Goal.** Agent files match `08-agent-system.md` (ADR-009).

**Files.** Create: `.claude/settings.json`, `.claude/hooks/{protect-files,verifier-test-only,format}.sh`, `.claude/rules/{core,engine,ui,api-db,testing,docs}.md`, `.claude/agents/{implementer,verifier}.md`, `.claude/skills/{execute-task,clarify,add-node,ui-screen,db-migration,release}/SKILL.md`. Delete: the files in 08 §9. Change: `CLAUDE.md`, `docs/MEMORY.md`, `docs/MEMORY-archive.md`.

**Steps.**
1. Create every file with the exact content of the fenced blocks in 08 §5–§8 (strip the outer fence). `chmod 755 .claude/hooks/*.sh`.
2. Delete the old files listed in 08 §9 (`git rm`).
3. Test the hooks with the commands of 08 §6.4: for each row run `printf '{"tool_input":{"file_path":"<repo>/<path>"}}' | CLAUDE_PROJECT_DIR=<repo> .claude/hooks/<script>.sh; echo $?` and compare the exit code.
4. Check the verifier hook is active: start the `verifier` subagent with the instruction "try to edit `apps/web/src/app/App.tsx` by adding a blank line, then report what happened". Expected: blocked. If the edit succeeds, the frontmatter `hooks` form is not supported (A-08-2): remove the `hooks:` block from `verifier.md`, revert the edit, note it in the Progress Log.
5. `CLAUDE.md`: delete the "Until **T-P0-02** is done" bullet of the "Transition" section.
6. `docs/MEMORY.md`, group "Kỹ thuật & tổ chức": move the lines dated `2026-10-30 12:51` (đội agent generator–verifier) and `2026-10-28 07:46` (mỗi thời điểm 1 developer) to the top of the same group in `docs/MEMORY-archive.md` as `~~…~~ → thay bởi <now>`; add at the top of the group in `MEMORY.md`: `<now> - Hệ thống agent mới đã dựng theo docs/redesign/08-agent-system.md: session chính làm task S/M, subagent implementer cho task L, verifier kiểm cuối mỗi phase (chỉ viết test, có hook chặn); mỗi lúc 1 subagent; trạng thái dự án chỉ ghi ở Progress Log của docs/redesign/06-refactor-plan.md.` (`<now>` from `TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M'`).

**AC.** (a) `find .claude -type f | sort` equals the list in **Files** (create) and nothing else. (b) All hook tests return the exit codes of 08 §6.4. (c) `wc -l CLAUDE.md` ≤ 120 and it contains no `@docs/` import. (d) Step 4 result recorded.

**Verify.** `V-BASE` (unchanged code) + AC commands.

**Rollback.** `git revert`; no runtime effect on the app.

### T-P0-03 · Owner actions and real-database checks · S · Depends: — (can wait for the owner while P1 proceeds)

**Goal.** RLS tests and one restore-verified backup are green on the real DB; repo private (AUD-01…03, 26, 29).

**Steps.**
1. Ask the owner (Vietnamese, one message) to do, with the step-by-step text from `README.md` section "Sao lưu và khôi phục": (i) add GitHub secrets `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`; (ii) set the repository to private (Settings → General → Danger Zone); (iii) in the Supabase dashboard turn on leaked-password protection if the plan offers it; (iv) in the app, tab "Cài đặt UI", press "Khôi phục tất cả" once. Status of this task becomes `waiting-owner`.
2. When the owner confirms (i): trigger workflow `db-tests.yml` ("Database tests on Supabase") with the GitHub tool, read the job log. Expected: one `db-tests: OK` line per file in `supabase/tests/*.sql` (5 files). Any `FAIL` → **stop all other work**, report, fix before continuing.
3. Trigger workflow `backup.yml` ("Supabase backup"); expected green including the restore check. A red run caused by a column / table mismatch means the real DB differs from `supabase/migrations/` → report as BLOCKING.
4. Run the Supabase security advisor; record remaining findings.
5. Record in the Progress Log: run URLs, number of OK lines, advisor findings, which of (ii)–(iv) the owner did.

**AC.** Both workflow runs green and linked in the Progress Log; advisor output recorded.

**Verify.** The two workflow logs.

**Rollback.** Nothing to roll back (tests self-roll-back; backup is read-only).

### T-P0-04 · Migration history baseline and DB type check · S · Depends: T-P0-03

**Goal.** Tooling can see which migrations are applied; `database.types.ts` matches the real schema (AUD-01, 21; ADR-010).

**Steps.**
1. Read-only: Supabase `list_tables` with `schemas: ["supabase_migrations"]`, `verbose: true`. Continue only if table `schema_migrations` exists with columns `version` (text, PK) and `name`. Otherwise stop and report (A-10-1).
2. Tell the owner what will be written (6 metadata rows, no schema effect) and wait for "OK".
3. Run with `execute_sql`:
   ```sql
   insert into supabase_migrations.schema_migrations (version, name) values
     ('20261026080000','core_schema'), ('20261026080100','rls'), ('20261026080200','rpc'),
     ('20261027080000','designer_versions'), ('20261109090000','ui_text_overrides'),
     ('20261109150000','ref_tables')
   on conflict (version) do nothing;
   ```
4. `list_migrations` must return exactly these 6 versions.
5. `generate_typescript_types` for the project; compare every table, column, nullability and enum-like union used in `src/api/database.types.ts` (path `src/lib/database.types.ts` if T-P1-01 is not done yet). Fix only the hand-written file. List each difference in the Progress Log (or "none").

**AC.** (a) `list_migrations` = 6 rows. (b) Type differences listed and fixed; `pnpm typecheck` green.

**Verify.** `V-BASE`.

**Rollback.** Owner runs in the SQL editor: `delete from supabase_migrations.schema_migrations where version in ('20261026080000','20261026080100','20261026080200','20261027080000','20261109090000','20261109150000');` (cannot go through MCP).

### T-P0-05 · Engine public surface and purity lint · M · Depends: —

**Goal.** UI imports only `engine/protocol` and `engine/formula/public`; the engine imports nothing outside itself; both enforced (AUD-04; ADR-003).

**Files.** Move: `src/lib/text-vars.ts` → `src/engine/core/text-vars.ts`. Create: `src/engine/formula/public.ts`. Change: `src/engine/protocol.ts`, `src/engine/core/i18n.ts`, `eslint.config.js`, and the importing files listed in step 4.

**Steps.**
1. `git mv apps/web/src/lib/text-vars.ts apps/web/src/engine/core/text-vars.ts`; in `engine/core/i18n.ts` import from `./text-vars`.
2. Append to `src/engine/protocol.ts`:
   ```ts
   export { textVars, sameVars } from './core/text-vars';
   export { formatIssue } from './io/validation';
   export type { ValidationIssue } from './io/validation';
   export type { RefImportResult } from './io/ref-import';
   export type { DesignCheckResult, DesignIssue, DesignNodeInfo, DesignNodeStatus } from './design';
   export type { PreviewOutcome } from './preview';
   export type { EngineApi } from './worker';
   ```
   (skip a name that `protocol.ts` already exports).
3. Create `src/engine/formula/public.ts`:
   ```ts
   export { FUNCTIONS, FUNCTION_GROUPS } from './functions';
   export { escapeRef, toDisplay, toStored, type RefColumn } from './refs';
   export { FormulaError } from './parser';
   export type { FormulaParamDef } from './compile';
   ```
4. In every non-test file under `src/features`, `src/lib`, `src/app`, `src/components` change imports of `engine/design`, `engine/io/validation`, `engine/io/ref-import`, `engine/preview`, `engine/worker`, `lib/text-vars` to `engine/protocol`, and imports of `engine/formula/{functions,refs,parser,compile}` to `engine/formula/public`. Find them with `grep -rnE "engine/(design|io/|preview|worker|formula/(functions|refs|parser|compile))|lib/text-vars" apps/web/src --include=*.ts --include=*.tsx | grep -vE "\.test\.|__tests__|^apps/web/src/engine/"`. The `new URL('../../engine/worker.ts', import.meta.url)` expression in `engine-client.ts` stays.
5. `eslint.config.js`: add after the existing engine block:
   ```js
   const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'];
   const zone = (files, forbidden) => ({
     files,
     ignores: TEST_FILES,
     rules: {
       'no-restricted-imports': [
         'error',
         { patterns: forbidden.map(([regex, message]) => ({ regex, message })) },
       ],
     },
   });
   const ENGINE_PUBLIC = [
     '/engine/(?!protocol$|formula/public$)',
     'Outside src/engine import only engine/protocol or engine/formula/public (02 §3).',
   ];
   ```
   (declare the three constants above `export default`) and add these two entries to the config array:
   ```js
   zone(['apps/web/src/engine/**/*.ts'], [
     ['^react', 'The engine is React-free.'],
     ['/(app|features|shared|api|ui|components|lib)(/|$)', 'The engine imports only engine/** and @hrflow/flow-schema.'],
   ]),
   zone(['apps/web/src/app/**', 'apps/web/src/features/**', 'apps/web/src/components/**', 'apps/web/src/lib/**'], [ENGINE_PUBLIC]),
   ```

**AC.** (a) The grep of step 4 prints nothing. (b) `pnpm lint` green; temporarily adding `import '../../lib/format'` to `src/engine/core/keys.ts` makes lint fail (then remove it). (c) Start-up JS grows by ≤ 1.0 KiB versus the previous build (`V-BUDGET`).

**Verify.** `V-BASE`, `V-LOCK`, `V-SAFE`.

---

## P1 — Module boundaries (moves; no behaviour or visual change)

Ends with: layers `app / features / shared / api / engine` exist and are lint-enforced; `src/lib/` is gone. Screens look and behave exactly as before (all screenshot baselines unchanged).

### T-P1-01 · Create `src/api/` (move as is) · M · Depends: T-P0-05

**Goal.** All Supabase access lives under `src/api/` (AUD-07; ADR-004).

**Moves** (`git mv`, tests move with their file; class and function names unchanged):

| From | To |
|------|----|
| `src/lib/supabase.ts`, `supabase.test.ts` | `src/api/supabase.ts`, `supabase.test.ts` |
| `src/lib/env.ts` | `src/api/env.ts` |
| `src/lib/database.types.ts` | `src/api/database.types.ts` |
| `src/features/admin/admin-api.ts`, `admin-api.test.ts` | `src/api/admin-api.ts`, `admin-api.test.ts` |
| `src/features/admin/ref-tables/ref-tables-api.ts` | `src/api/ref-tables-api.ts` |
| `src/features/admin/ui-text/ui-text-api.ts` | `src/api/ui-text-api.ts` |
| `src/features/runner/supabase-flow-source.ts`, `__tests__/supabase-flow-source.test.ts` | `src/api/runs-api.ts`, `src/api/runs-api.test.ts` |
| `src/features/runner/flow-source.ts` | `src/api/flow-source.ts` |

**Steps.**
1. Do the moves in one commit; fix import paths until `pnpm typecheck` passes.
2. Move the interface `RunLogger` from `src/features/runner/run-log.ts` into `src/api/flow-source.ts`; `run-log.ts` and `runs-api.ts` import it from there.
3. In `src/lib/ui-text.ts`: move the Supabase query of `loadTextOverrides` into `src/api/ui-text-api.ts` as `export async function listEditedTexts(sb: UiTextClient): Promise<[string, string][]>` (select `key, value` where `value` is not null; on failure return `[]`). Change `loadTextOverrides` to `loadTextOverrides(load: () => Promise<[string, string | null][]>, waitMs = 1500)`. In `src/app/services.ts` pass `() => listEditedTexts(sb)`. Update `lib/ui-text.test.ts` to the new signature (same assertions).
4. Create `src/api/client.ts` exporting `getAdminApi(): AdminApi` and `getRefTablesApi(): RefTablesApi` (lazy singletons built with `getSupabase()`). `src/features/admin/use-admin.ts` `useAdminApi()` and `src/features/admin/ref-tables/shared.tsx` `useRefApi()` return these instead of constructing with `getSupabase()`.
5. `eslint.config.js`: add `zone(['apps/web/src/api/**'], [['^react', 'api is UI-free.'], ['/(app|features|shared|ui|components|lib)(/|$)', 'api imports only api/**, engine/protocol types and @hrflow/flow-schema.'], ['/engine/(?!protocol$)', 'api may import only engine/protocol.']])`.

**AC.** (a) `grep -rnE "getSupabase\(|from '@supabase/supabase-js'" apps/web/src --include=*.ts --include=*.tsx | grep -vE "\.test\.|^apps/web/src/api/|^apps/web/src/app/services.ts"` → no output. (b) `grep -rnE "\.from\('|\.rpc\('|functions\.invoke" apps/web/src --include=*.ts --include=*.tsx | grep -vE "\.test\.|^apps/web/src/api/|^apps/web/src/features/auth/auth-service.ts"` → no output. (c) No screenshot baseline changed.

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E e2e/auth.spec.ts e2e/admin-users.spec.ts e2e/admin-flows.spec.ts e2e/ref-tables.spec.ts e2e/ui-text.spec.ts e2e/run-log.spec.ts`.

### T-P1-02 · Create `src/shared/` (move cross-feature modules) · M · Depends: T-P1-01

**Goal.** No feature imports another feature (AUD-06).

**Moves** (`git mv`; a test moves when it tests only the moved module):

| From | To |
|------|----|
| `src/features/auth/{auth-service.ts, auth-context.tsx, guard.ts, credentials.ts, session-revoke.ts}` + their tests (`auth-service.test.ts`, `auth.test.ts`, `session-revoke.test.ts`) | `src/shared/auth/` |
| `src/features/auth/idle/activity.ts` | `src/shared/engine/activity.ts` |
| `src/features/runner/engine-client.ts`, `__tests__/engine-client.test.ts`, `__tests__/engine-client-texts.test.ts` | `src/shared/engine/` (tests in `src/shared/engine/__tests__/`) |
| `src/features/runner/as-of.ts` | `src/shared/versioning/as-of.ts` |
| `src/features/admin/versions/version-ranges.ts` | `src/shared/versioning/version-ranges.ts` |
| `src/features/runner/components/ParamsCard.tsx` | `src/shared/flow/ParamsCard.tsx` |
| `src/lib/format.ts`, `format.test.ts`, `src/lib/download.ts` | `src/shared/util/` |
| `src/lib/ui-text.ts`, `ui-text.test.ts`, `src/i18n.ts` | `src/shared/i18n/ui-text.ts`, `ui-text.test.ts`, `src/shared/i18n/i18n.ts` |

**Steps.**
1. Do the moves in one commit; fix imports (including `src/main.tsx`, `src/showcase/main.tsx`, `src/app/*`, tests, and `e2e/` if any spec imports a moved path).
2. Create `src/shared/versioning/version-status.ts`: move the constant `VERSION_STATUS_TONE` out of `src/features/admin/versions/FlowVersionsPage.tsx` into it (same value, same type); `FlowVersionsPage.tsx` and `src/features/designer/DesignerEditor.tsx` import it from there.
3. `src/lib/` must now be empty → delete the folder.
4. `eslint.config.js`: add `zone(['apps/web/src/shared/**'], [['/(app|features)(/|$)', 'shared imports only shared/**, api/**, ui (or components until T-P3-08), engine public modules.'], ENGINE_PUBLIC, ['^@supabase/supabase-js', 'Only src/api talks to Supabase; take the client type from api/supabase.']])`. Remove `'apps/web/src/lib/**'` from the zone added in T-P0-05.

**AC.** (a) `grep -rnE "from '(\.\./)+(auth|runner|designer|admin)/" apps/web/src/features --include=*.ts --include=*.tsx | grep -vE "\.test\.|__tests__"` filtered to lines whose target feature differs from the file's own feature → no output (check with the loop in `01-current-state-audit.md` AUD-06 evidence). (b) `test ! -d apps/web/src/lib`. (c) No screenshot baseline changed.

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E-FULL` (moves touch every area).

### T-P1-03 · Split `AdminApi`, one error type, `useResource` · M · Depends: T-P1-02 · **verify**

**Goal.** One API class per resource; one error type; one data hook (AUD-07; ADR-004).

**Files.** Create: `src/api/{errors,users-api,groups-api,assignments-api,flows-api}.ts`, `src/shared/hooks/use-resource.ts`. Change: `src/api/{client,ref-tables-api,ui-text-api}.ts` and all callers. Delete: `src/api/admin-api.ts`, `src/features/admin/use-admin.ts`.

**Steps.**
1. `src/api/errors.ts`: move from `admin-api.ts` the items `AdminErrorKey`, `PgErrorLike`, `dbErrorKey`, `functionErrorKey`, `errorKeyOf`; move from `ref-tables-api.ts` the items `RefErrorKey`, `refErrorKey`, `refErrorText`. Then: `export type ApiErrorKey = AdminErrorKey | RefErrorKey;` `export class ApiError extends Error { constructor(readonly key: ApiErrorKey) { super(key); this.name = 'ApiError'; } }`. Replace `AdminApiError` and `RefApiError` by `ApiError` everywhere (delete both classes). `errorKeyOf(e)` returns `e instanceof ApiError ? e.key : 'unknown'` and replaces `refErrorOf`. Rename `refErrorText` → `apiErrorText` (same body).
2. Split the class `AdminApi` (methods keep their names and bodies):

   | New file · class | Methods |
   |---|---|
   | `users-api.ts` · `UsersApi` | `listUsers`, every method that calls the private `call()` (Edge Function `admin-users`: create, update, reset password, set active …), and `call` itself |
   | `groups-api.ts` · `GroupsApi` | `listGroups`, `createGroup`, `updateGroup`, `deleteGroup`, and any group-member method |
   | `assignments-api.ts` · `AssignmentsApi` | `listAssignments`, `assign`, `unassign` |
   | `flows-api.ts` · `FlowsApi` | `listFlows`, `getFlowVersions`, `createDraftFromVersion`, `publishDraft`, `saveDraft`, `retireVersion`, `setEffectiveTo`, `discardDraft`, `publishFlow`, flow creation |

   Interfaces (`AdminUser`, `AdminGroup`, `AdminFlow`, `AdminFlowVersion`, `AdminVersionDetail`, `FlowVersions`, `PublishDraftInput`, `PublishFlowInput`, `Assignment`) move to the file of the class that returns them. Split `admin-api.test.ts` the same way (each `describe` goes with its methods).
3. `src/api/client.ts`: replace the two getters by
   `export interface Api { users: UsersApi; groups: GroupsApi; assignments: AssignmentsApi; flows: FlowsApi; refTables: RefTablesApi }` and `export function getApi(): Api` (lazy singleton). Callers of `useAdminApi()` / `useRefApi()` use `getApi().<resource>`; delete `useAdminApi`, `useRefApi`.
4. `src/shared/hooks/use-resource.ts`:
   ```ts
   export interface Resource<T> { data: T | null; error: ApiErrorKey | null; loading: boolean; reload: () => void }
   /** `load` must have a stable identity (module-level function or useCallback). */
   export function useResource<T>(load: () => Promise<T>): Resource<T>
   ```
   Body = today's `useAdminQuery` (`src/features/admin/use-admin.ts`) without the `api` argument, plus `loading` (true from mount / `reload()` until the promise settles). Replace every `useAdminQuery(fn)` call by `useResource(fn)` where `fn` is a module-level function that calls `getApi()`. Delete `use-admin.ts`.

**AC.** (a) `test ! -f apps/web/src/api/admin-api.ts && test ! -f apps/web/src/features/admin/use-admin.ts`. (b) `grep -rn "AdminApiError\|RefApiError\|useAdminQuery\|useAdminApi\|useRefApi" apps/web/src` → no output. (c) Unit test count ≥ the count before the task (record both). (d) No screenshot baseline changed.

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E e2e/admin-users.spec.ts e2e/admin-flows.spec.ts e2e/versions.spec.ts e2e/ref-tables.spec.ts e2e/ref-tables-qa.spec.ts e2e/designer.spec.ts e2e/confirm-busy.spec.ts`, then `verifier`.

### T-P1-04 · Restructure `features/admin` · S · Depends: T-P1-03

**Moves** (`git mv`, import fixes only):

| From | To |
|------|----|
| `src/features/admin/AdminUsersPage.tsx` | `src/features/admin/users/AdminUsersPage.tsx` |
| `src/features/admin/AdminFlowsPage.tsx` | `src/features/admin/flows/AdminFlowsPage.tsx` |
| `src/features/admin/versions/` (all files and tests) | `src/features/admin/flows/versions/` |

Update lazy imports in `src/app/router.tsx`. `AdminLayout.tsx` and `AdminConfirm.tsx` stay in `src/features/admin/`.

**AC.** `ls apps/web/src/features/admin` = `AdminConfirm.tsx AdminLayout.tsx flows ref-tables ui-text users`. No baseline changed.

**Verify.** `V-BASE`, `V-E2E e2e/admin-access.spec.ts e2e/admin-users.spec.ts e2e/admin-flows.spec.ts e2e/versions.spec.ts`.

### T-P1-05 · Enforce all import zones · S · Depends: T-P1-04 · **verify (end of P1)**

**Goal.** The matrix of `02-target-architecture.md` §3 is a lint error (AUD-05).

**Steps.** In `eslint.config.js` replace the zone for `app/features/components` added in T-P0-05 by these entries (keep the `engine`, `api`, `shared` zones):
```js
const feature = (name, others) =>
  zone([`apps/web/src/features/${name}/**`], [
    [`^(\\.\\./)+(${others.join('|')})(/|$)`, 'No cross-feature import: move shared code to src/shared (02 §3).'],
    ['^(\\.\\./)+app(/|$)', 'Features do not import src/app.'],
    ENGINE_PUBLIC,
    ['^@supabase/supabase-js', 'Only src/api talks to Supabase.'],
    ['/ui/(?!data/DataGrid$)', 'Import from the ui barrel (or ui/data/DataGrid).'],
  ]);
// in the config array:
feature('auth', ['runner', 'designer', 'admin']),
feature('runner', ['auth', 'designer', 'admin']),
feature('designer', ['auth', 'runner', 'admin']),
feature('admin', ['auth', 'runner', 'designer']),
zone(['apps/web/src/app/**'], [ENGINE_PUBLIC]),
zone(['apps/web/src/components/**'], [
  ['/(app|features|shared|api|engine)(/|$)', 'UI kit has no app knowledge.'],
]),
```
Then delete the "Transition" section of `CLAUDE.md` (all layers now exist except `ui/`, which the Progress Log tracks).

`src/components/KpiCard.tsx` imports `lib/format` (now `shared/util/format`): change `KpiCard` to receive the already formatted string (`value: string`) and format at its call sites (`formatInteger`), so the zone passes.

**AC.** (a) `pnpm lint` green. (b) Each of these temporary edits makes lint fail, then is removed: a `features/runner` file importing `../admin/AdminLayout`; a `features/designer` file importing `../../engine/design`; a `components` file importing `../shared/util/format`. (c) No baseline changed.

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E-FULL`, then `verifier` on the whole of P1 (focus: nothing but moves and the listed splits; no behaviour change; privacy spec).

---

## P2 — Design System v3 foundation

Ends with: `src/ui/` complete and shown on the showcase page, approved by the owner (GATE-2). No production screen changed yet.

Common rules for P2: new files only under `src/ui/`, `src/showcase/`, `e2e/`; components are built by **copying the logic** of the matching `src/components/` file and applying 04 §5–§6 (v3 utilities, props without `className`); pure logic files are moved, not copied (`git mv` to `src/ui/logic/` and update the old component's import). Every component is added to `src/ui/index.ts` (except `DataGrid`) and to the showcase page.

### T-P2-01 · Tokens, density, v3 guard test · M · Depends: T-P1-05

**Files.** Create: `src/ui/tokens/{primitives,semantic,density}.css`, `src/ui/theme.css`, `src/ui/index.ts` (empty barrel), `src/ui/__tests__/{v3-scope.ts,ds-v3.test.ts}`. Change: `src/index.css` (add `@import './ui/theme.css';` after the Tailwind import), `src/components/__tests__/design-tokens.test.ts`, `apps/web/bundle-budget.json`, `apps/web/scripts/check-bundle-size.mjs`, `eslint.config.js`.

**Steps.**
1. `primitives.css`: `:root { --p-… }` holding every hex of 04 §5.2 once (name by family + step, e.g. `--p-teal-700: #0f766e`).
2. `semantic.css`: `:root { --ds-color-<token>: var(--p-…); }` for every row of 04 §5.2; shadows, radii of 04 §5.5.
3. `density.css`: `:root, [data-density='comfortable'] { … }` and `[data-density='compact'] { … }` defining, for each row of 04 §5.3 and §5.4, `--ds-text-<name>`, `--ds-text-<name>-lh`, `--ds-ctl-h`, `--ds-ctl-sm-h`, `--ds-tr-h`, `--ds-th-h`, `--ds-gutter`, `--ds-page-y`, `--ds-block`, `--ds-group`, `--ds-item`, `--ds-pad`, `--ds-cell`; plus `@media (max-width: 767px) { :root { … } }` for the mobile column (comfortable only).
4. `theme.css`: one `@theme inline { … }` block mapping: `--color-<token>: var(--ds-color-<token>)` (all of §5.2); `--text-<name>: var(--ds-text-<name>)`, `--text-<name>--line-height: var(--ds-text-<name>-lh)`, `--text-<name>--font-weight: 400|600` (per §5.3; `overline` also `--letter-spacing: 0.06em`); `--spacing-ctl`, `-ctl-sm`, `-tr`, `-th`, `-gutter`, `-page-y`, `-block`, `-group`, `-item`, `-pad`, `-cell` → the `--ds-*` variables; `--radius-chip|control|container|full`; `--shadow-overlay|raised`; `--z-index` is not a Tailwind namespace, so add utilities `@utility z-sticky { z-index: 10; }` … `z-toast` (10/20/30/40/50). Do **not** reset any namespace (`--color-*: initial` stays only in the v2 block).
5. `v3-scope.ts`: `export const V3_SCOPE: string[] = ['ui', 'showcase'];` (paths relative to `src/`).
6. `design-tokens.test.ts`: make `tsxFiles(SRC)` skip any directory or file listed in `V3_SCOPE` (import it), so v2 rules ignore v3 code. No other change.
7. `ds-v3.test.ts`: scans `.tsx` files inside `V3_SCOPE` and fails on (per string literal, comments stripped — reuse the helper approach of `design-tokens.test.ts`): hex / `rgb(` / `hsl(` colours; arbitrary values `-[…]`; any v2 utility of 04 §11 left column; Tailwind default names `text-(xs|sm|base|lg|xl|[2-9]xl)`, `rounded-(sm|md|lg|xl|2xl|3xl)`, `shadow-(sm|md|lg|xl|2xl)`, default palette `(bg|text|border)-(red|blue|green|slate|gray|zinc|…)-\d+`; numeric spacing utilities whose step is not in `1 2 3 4 6 8 12 16` (plus `0`, `px`, `0.5` for borders); `font-(medium|bold|extrabold|light)`; and, outside `ui/`: JSX `<table`, `<dialog`, `<main`, `type="file"`, `className=` on a component imported from `ui`. Include a self-test that each pattern is caught (like the existing "the scanner catches each forbidden pattern"). Add token tests: every `--ds-color-*` used as text on a surface in 04 §5.2 meets the contrast in the table (compute with the WCAG formula from the hex values in `primitives.css`).
8. Density proof (A-04-3): add to `src/showcase/` a minimal page section with two sibling containers `data-density="comfortable"` / `"compact"`, each holding `<div class="h-ctl text-ui">`; add `e2e/ui-density.spec.ts` asserting computed `height` 44px vs 36px and `font-size` 16px vs 14px. **If this fails, stop and report** — the token design in 04 §5.1 must be revised before any further P2 task.
9. `bundle-budget.json`: replace the relative CSS rule by an absolute one for the migration window: add `"cssLimitGzipBytes": 61440` and make `check-bundle-size.mjs` use it when present (keep the old fields untouched for T-P3-08). **Requires owner confirmation A-06-3 before this step**; if refused, stop.
10. `eslint.config.js`: add `zone(['apps/web/src/ui/**'], [['/(app|features|shared|api|engine|components|lib)(/|$)', 'ui has no app knowledge (02 §3).'], ['^@supabase/', 'ui has no app knowledge.'], ['^@tanstack/react-router', 'Pass links in as props.'], ['^@hrflow/', 'ui has no app knowledge.']])`.

**AC.** (a) `e2e/ui-density.spec.ts` passes. (b) `ds-v3.test.ts` passes and its self-test catches every pattern. (c) All existing screenshot baselines unchanged (v3 CSS adds variables and utilities only). (d) CSS size recorded; under 60 KiB gzip.

**Verify.** `V-BASE`, `V-E2E e2e/ui-density.spec.ts e2e/ui-v2.spec.ts e2e/ui-v2-diacritics.spec.ts`.

### T-P2-02 · Primitives: Button, IconButton, LinkButton, Chip, Card, Callout, text helpers, icons · M · Depends: T-P2-01

**Files.** Create under `src/ui/`: `Button.tsx` (+ `LinkButton`), `IconButton.tsx`, `Chip.tsx`, `Card.tsx`, `Callout.tsx`, `Text.tsx` (`OneLine`, `MiddleCut`, `Overline`), `tone.ts` (`Tone` type + maps tone → `status-*` utilities). Move: `src/components/icons/index.tsx` → `src/ui/icons/index.tsx`; re-export it from `src/ui/index.ts` (`export * from './icons';`). Old components import it from `../ui/icons`; files under `src/features` and `src/app` that imported `components/icons` import the icons from the `ui` barrel.

**Steps.** Props exactly as 04 §6.1. Sources of logic: `src/components/ui.tsx` (`Button`, `Card`, `Chip`, `Callout`, `useTextCut`, `OneLine`, `MiddleCut`, `Eyebrow`). v2 tones `teal|coral|amber|blue|neutral` map to `positive|negative|warning|info|neutral`. No class-string export. Heights via `h-ctl` / `h-ctl-sm`; radius `rounded-control`; focus ring from the base layer. Add each component, in every variant, size and tone, in both densities, to `src/showcase/ShowcaseApp.tsx` under a new "DS v3" section.

**AC.** `ds-v3.test.ts` green; axe on the showcase reports 0 violations (extend `e2e/ui-frame.spec.ts` axe check to the new section).

**Verify.** `V-BASE`, `V-E2E e2e/ui-density.spec.ts e2e/ui-frame.spec.ts`.

### T-P2-03 · Showcase "foundations" and GATE-1 · S · Depends: T-P2-02 · **owner gate**

**Goal.** The owner approves tokens, type, density and basic components before the rest is built.

**Steps.**
1. Showcase section "Foundations": colour table (each semantic token with name and value), the 9 type styles in both densities with Vietnamese sample text containing stacked diacritics, spacing / size table, radii, shadows, and the T-P2-02 components side by side in comfortable and compact.
2. Build `pnpm --filter @hrflow/web build:e2e`; capture the showcase at 1280 and 390 px; publish one Artifact with the screenshots and a short Vietnamese note listing what changes versus today (04 D-04-2, D-04-3).
3. Ask the owner (A/B/C, recommended first): **(1)** density of Admin and Designer — A compact (36 px controls, 14 px text) / B comfortable everywhere; **(2)** positive colour — A keep teal / B green; **(3)** palette and font — A keep / B the owner names the change; **(4)** radii 8 / 12 — A accept / B keep 6 / 12.
4. Record the answers in `docs/MEMORY.md` (one line) and apply them in `src/ui/tokens/*.css` and 04 §5 / §12 in the same commit.

**AC.** Owner answers recorded; tokens match the answers; `ds-v3.test.ts` green.

**Verify.** `V-BASE`, `V-E2E e2e/ui-density.spec.ts` (update its expected numbers if answer 1 = B).

### T-P2-04 · Form controls · M · Depends: T-P2-03

**Files.** Create `src/ui/form/{FormField,FieldGrid,TextInput,Textarea,Checkbox,RadioGroup,FileDrop}.tsx`.

**Steps.** Props as 04 §6.2. Logic sources: `src/components/FormField.tsx` (`FormField`, `FieldGrid`, `fitColumns`, `columnsFor`, `Checkbox`, `TextInput`, `Textarea`, `fieldIds`); `RadioGroup` from `RoleRadios` in `AdminUsersPage.tsx`; `FileDrop` from the drop zone of `src/features/runner/components/SlotCard.tsx` (keyboard: the zone is a `<button>` that opens the hidden native input; drag-and-drop; file list with `MiddleCut` and a remove `IconButton`; `compact` variant = single-row button + file name for panels). `FieldGrid` has no `dense` prop. Showcase: every control in default / filled / invalid / disabled, both densities.

**AC.** `ds-v3.test.ts` green; axe 0 violations on the section; unit test for `fitColumns` / `columnsFor` moved or kept passing.

**Verify.** `V-BASE`, `V-E2E e2e/ui-frame.spec.ts`.

### T-P2-05 · Popover and overlays: Tooltip, InfoTip, Menu · M · Depends: T-P2-04

**Files.** Create `src/ui/logic/popover-position.ts` (+ test), `src/ui/overlay/{Popover,Tooltip,InfoTip,Menu}.tsx`. Move `src/components/menu-logic.ts` (+ test) → `src/ui/logic/`.

**Steps.**
1. `popover-position.ts`: one pure function `place(anchor: DOMRect, size: {width,height}, viewport: {width,height}, placement, gap = 4): { left, top, placement }` with flip and clamp; unify the behaviour of `panelShift` (`picker-shared.tsx`) and the positioning code in `Select.tsx`, `Menu.tsx`, `Tooltip.tsx`, `InfoTip.tsx`. Unit tests: fits below; flips above near the bottom edge; clamps at the right edge; anchor inside a scrolled container.
2. `Popover`: renders next to its anchor (no portal, 04 §5.6), closes on outside pointer-down and Esc (Esc inside a `<dialog>` closes only the popover: `preventDefault`), returns focus to the anchor, `z-dropdown`.
3. `Tooltip`, `InfoTip` (single-open store as today), `MenuButton` (APG; `menu-logic.ts`) on top of `Popover`.

**AC.** Unit tests of `popover-position` pass; showcase shows each overlay inside a page and inside a `Dialog`; E2E in `e2e/ui-frame.spec.ts`: Esc closes only the top layer.

**Verify.** `V-BASE`, `V-E2E e2e/ui-frame.spec.ts`.

### T-P2-06 · Select, DatePicker, MonthPicker · M · Depends: T-P2-05

**Files.** Create `src/ui/form/{Select,DatePicker,MonthPicker}.tsx`. Move `src/components/select-logic.ts`, `calendar.ts` (+ tests) → `src/ui/logic/`.

**Steps.** Props as 04 §6.2; behaviour identical to the current components (search without diacritics, groups, keyboard, Vietnamese month labels, min / max); positioning through `Popover`. Showcase + copy the existing E2E cases of `e2e/select.spec.ts` and `e2e/pickers.spec.ts` to run against the showcase versions too.

**AC.** New showcase E2E cases pass; existing `select.spec.ts` / `pickers.spec.ts` still pass (old components untouched).

**Verify.** `V-BASE`, `V-E2E e2e/select.spec.ts e2e/pickers.spec.ts e2e/ui-frame.spec.ts`.

### T-P2-07 · Dialog, ConfirmDialog, Toast · S · Depends: T-P2-05

**Files.** Create `src/ui/overlay/{Dialog,ConfirmDialog,Toast}.tsx`. Move `src/components/toast-store.ts` → `src/ui/logic/`.

**Steps.** Props as 04 §6.3; native `<dialog>` + `showModal()` as today (`src/components/Dialog.tsx`); `busy` blocks Esc and backdrop close; danger confirm focuses Cancel; one toast region.

**AC.** Showcase E2E: focus trap, Esc blocked while busy, toast announced (`role="status"`).

**Verify.** `V-BASE`, `V-E2E e2e/ui-frame.spec.ts e2e/confirm-busy.spec.ts`.

### T-P2-08 · Layout components · M · Depends: T-P2-07

**Files.** Create `src/ui/layout/{AppFrame,TopBar,SideNav,PageShell,PageHeader,Section,Toolbar,StickyActionBar,Tabs,Stepper,SplitPane}.tsx`. Move `src/components/tabs-logic.ts` → `src/ui/logic/`.

**Steps.** Props as 04 §6.4. Sources: `src/app/AppShell.tsx` (frame, skip link, scroll frame attributes `data-app-shell`, `data-scroll-frame` — keep the attribute names, `src/app/scroll-frame.ts` depends on them), `src/components/layout/*`, `Tabs.tsx`, `Stepper.tsx`. `SideNav` takes `groups` (04 §3) and a `linkComponent`. `SplitPane` is new: two panes, a 4 px separator with `role="separator"`, `aria-orientation`, `aria-valuenow`, pointer drag and arrow-key resize (16 px steps), `minSize`, optional collapse button with `collapsedLabel`; size kept in component state only. Showcase: one full "frame" page per template of 04 §7.1 built from fake content, in both densities.

**AC.** Showcase E2E: `SplitPane` resizes by keyboard and collapses; no horizontal page scroll at 1280 / 1024 / 390 on the template pages (`layout-lint` run on the showcase routes).

**Verify.** `V-BASE`, `V-E2E e2e/ui-frame.spec.ts e2e/layout-lint.spec.ts`.

### T-P2-09 · Data components · L · Depends: T-P2-08

**Files.** Create `src/ui/data/{DataTable,DataGrid,KpiCard,EmptyState,ErrorState,Skeleton,ProgressBar}.tsx`.

**Steps.** Props as 04 §6.5.
- `DataTable`: from `src/components/DataTable.tsx` + `RowActions.tsx`; built-in `state` rendering (skeleton rows / `ErrorState` with retry / `empty`); actions column pinned right with one `IconButton` + `MenuButton`.
- `DataGrid`: from `src/features/runner/components/ResultTable.tsx` (TanStack Table + Virtual): sticky header, optional row-number header, `highlight` callback returning a `Tone`, `getRows(range)` paging or in-memory `rows`. It always uses compact cell metrics (wrap its root in `data-density="compact"`). Not exported from the barrel.
- `KpiCard` takes `value: string` (no formatting inside, AUD-28).
- `Skeleton` / `LoadingRegion` from `src/components/Skeleton.tsx` without page-specific skeletons (`FlowCardsSkeleton`, `DesignerSkeleton` stay with their feature until migrated).
- `ProgressBar` from `src/features/runner/components/RunProgress.tsx` bar markup.
Showcase: each with loading / empty / error / ready; a 10,000-row `DataGrid`.

**AC.** Showcase E2E: `DataGrid` renders < 200 row elements for 10,000 rows and keeps the header visible after scrolling; `DataTable` states switch correctly; start-up JS unchanged (`DataGrid` not in the entry graph: `V-BUDGET`).

**Verify.** `V-BASE`, `V-E2E e2e/ui-frame.spec.ts e2e/layout-lint.spec.ts`.

### T-P2-10 · Showcase complete and GATE-2 · S · Depends: T-P2-09, T-P2-06 · **owner gate · verify (end of P2)**

**Steps.**
1. Run `verifier` on P2 (focus: a11y of each component, no app import in `ui/`, bundle).
2. Capture every showcase section and the template pages at 1280 / 1024 / 390; inspect each image for overflow, overlap, uneven heights; fix before showing.
3. Publish one Artifact (images + short Vietnamese note). Ask the owner: approve the component set and page templates — A approve / B approve with listed changes / C redo a named part.
4. Record the decision in `docs/MEMORY.md`; apply listed changes; update 04.

**AC.** Owner approval recorded. No screen of the real app has changed (existing baselines unchanged).

**Verify.** `V-BASE`, `V-E2E-FULL`.

---

## P3 — Screen migration to DS v3

Common procedure for every P3 task (skill `ui-screen`): replace imports from `src/components/` by `ui`; apply the 04 §11 mapping; use the page template of 04 §4; keep every i18n key; add the migrated folder / files to `V3_SCOPE`; update **only** visual-value assertions and regenerate **only** this task's baselines (`CI=1 npx playwright test <spec> --update-snapshots --trace off` after `build:e2e`), inspecting each image at every viewport; never change a behavioural assertion. If a behavioural E2E test fails, the migration is wrong.

Visual-value files that may be edited in P3: `e2e/ui-v2-checks.ts`, `e2e/ui-v2*.spec.ts`, `e2e/ui-frame*.spec.ts`, `e2e/ui-final-qa.spec.ts`, `e2e/scroll-frame-qa.spec.ts`, `e2e/scrollbar-shift.spec.ts`, `e2e/layout-lint.ts` (constants only), and `e2e/__screenshots__/**`.

### T-P3-01 · App frame, auth and User entry screens · L · Depends: T-P2-10

**Scope.** `src/app/{AppShell.tsx, UserMenu.tsx}`, `src/features/auth/**` (Login, ChangePassword, AuthLayout, IdleLogout), `src/features/runner/{FlowListPage,RunPage}.tsx`, `src/features/runner/components/{SlotCard,RunProgress,ValidationReport}.tsx`, `src/shared/flow/ParamsCard.tsx`, `src/shared/auth/*` (no UI change expected).

**Steps.**
1. `AppShell.tsx` renders `ui` `AppFrame` + `TopBar` (density comfortable); keep the admin badge (`Chip tone="info"`) and `UserMenu` (on `MenuButton`).
2. Login / ChangePassword → template Auth. Flow list → template List (cards + `DataTable` for recent runs). Run → template Wizard; `SlotCard` uses `FileDrop`; validation report uses `DataGrid`; progress uses `ProgressBar`.
3. `IdleLogout` uses `ui` `Dialog`.
4. `e2e/layout-lint.ts`: replace `const CONTROL_H = 44; const SMALL_H = 36;` by values read in the page from the element's nearest `[data-density]` (`getComputedStyle(el).getPropertyValue('--ds-ctl-h')` / `--ds-ctl-sm-h`, parsed to px). No rule removed.
5. All these screens are in the entry graph: after this task the entry must not import `src/components/` at all — check with `grep -rn "components/" apps/web/src/app apps/web/src/features/auth apps/web/src/features/runner/FlowListPage.tsx apps/web/src/features/runner/RunPage.tsx apps/web/src/features/runner/components apps/web/src/shared`.

**AC.** (a) The grep of step 5 prints nothing. (b) `V-BUDGET` ≤ 240 KiB (record). (c) Behavioural specs unchanged and green. (d) Baselines of login, change-password, flow list, run regenerated and inspected at 1280 / 1024 / 390.

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E e2e/auth.spec.ts e2e/auth-session.spec.ts e2e/auto-logout.spec.ts e2e/auto-logout-tabs.spec.ts e2e/acceptance.spec.ts e2e/validation-ui.spec.ts e2e/cancel.spec.ts e2e/run-versions.spec.ts e2e/run-log.spec.ts e2e/privacy.spec.ts e2e/a11y.spec.ts e2e/layout-lint.spec.ts e2e/ui-v2.spec.ts e2e/ui-v2-diacritics.spec.ts`.

### T-P3-02 · Result screen · M · Depends: T-P3-01

**Scope.** `src/features/runner/ResultPage.tsx`, `components/ResultTable.tsx`.

**Steps.** Template Report: `PageHeader` (conclusion sentence), `KpiRow` / `KpiCard` (format numbers at the call site), inverse `Card`, `Tabs`, `DataGrid` (delete `ResultTable.tsx` once nothing imports it; keep its filter behaviour through `DataGrid` `filters`). First confirm AUD-18 on screen with a flow that has no `control.compare`; if confirmed, do **not** fix it here — add backlog item B-05 note "confirmed".

**AC.** `e2e/result.spec.ts`, `e2e/result-preview.spec.ts` behavioural assertions green; baselines of the result states regenerated and inspected; `ResultPage` chunk still lazy (`V-BUDGET`).

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E e2e/result.spec.ts e2e/result-preview.spec.ts e2e/acceptance.spec.ts e2e/layout-lint.spec.ts e2e/a11y.spec.ts e2e/ui-v2.spec.ts`.

### T-P3-03 · Admin frame, navigation, users / groups / assignments · L · Depends: T-P3-01 · **verify**

**Scope.** `src/features/admin/AdminLayout.tsx`, `src/features/admin/users/**`, `src/app/router.tsx`, `src/locales/vi/common.json`.

**Steps.**
1. `AdminLayout.tsx`: `ui` `SideNav` with the groups of 04 §3, wrapped in `data-density="compact"` (or the GATE-1 answer). Create `src/features/admin/nav.ts` exporting the group / item list. Delete the items `dashboard`, `templates`, `logs` and the "soon" chip rendering. Add i18n keys `admin.nav.group.flows|people|system`, `admin.nav.accounts`, `admin.nav.groups`, `admin.nav.assignments` with the texts of 04 §3 (do not delete or rename existing keys that are still referenced; remove `admin.nav.dashboard|templates|logs|soon` only if no code references them).
2. Router: `/admin` index redirects to `/admin/flows`; add lazy routes `/admin/groups` and `/admin/assignments`.
3. Split `AdminUsersPage.tsx` into files in `src/features/admin/users/`: `UsersPage.tsx` (users table + `PageHeader` action "create"), `GroupsPage.tsx`, `AssignmentsPage.tsx`, `CreateUserDialog.tsx`, `EditUserDialog.tsx`, `TempPasswordDialog.tsx`, `GroupDialog.tsx`. Each page loads its own data with `useResource`; logic and texts unchanged. Template List; tables on `DataTable`; `RoleRadios` → `RadioGroup`; `GroupCheckboxes` → `Checkbox` list.
4. E2E: specs that reach groups or assignments through `/admin/users` navigate to the new routes (navigation lines only); add one test: `/admin` redirects to `/admin/flows`; add `/admin/groups` and `/admin/assignments` to `layout-lint` and `a11y`.

**AC.** (a) `test ! -f apps/web/src/features/admin/users/AdminUsersPage.tsx`; no file in `users/` above 400 lines. (b) All assertions of `e2e/admin-users.spec.ts`, `e2e/admin-access.spec.ts` pass with only navigation lines changed. (c) No "Sắp ra mắt" text rendered in the menu. (d) Baselines regenerated and inspected (1280 / 1024).

**Verify.** `V-BASE`, `V-E2E e2e/admin-users.spec.ts e2e/admin-access.spec.ts e2e/confirm-busy.spec.ts e2e/scroll-frame-qa.spec.ts e2e/scrollbar-shift.spec.ts e2e/layout-lint.spec.ts e2e/a11y.spec.ts e2e/ui-v2.spec.ts`, then `verifier`.

### T-P3-04 · Shared versioning forms; flows and versions screens · L · Depends: T-P3-03

**Scope.** `src/shared/versioning/{PublishForm,EndDateForm}.tsx` (new), `src/features/admin/flows/**`.

**Steps.**
1. Create `PublishForm.tsx` and `EndDateForm.tsx` exactly per ADR-007 by lifting the common code of `PublishForm` / `EndDateForm` in `FlowVersionsPage.tsx`; the flow-specific design check (`checkDefinition`, problems list) is passed as `children` + `blocked`. Texts: existing `common` keys.
2. `FlowVersionsPage.tsx` uses the shared forms inside `ui` `Dialog`; template Detail; `Timeline`, `ComparePickers`, `DiffView` restyled; split so no file exceeds 400 lines (`Timeline.tsx`, `VersionsTable.tsx`).
3. `AdminFlowsPage.tsx` → `FlowsPage.tsx` (template List) + `ImportFlowDialog.tsx` (uses `FileDrop`) + `CreateFlowDialog.tsx`.

**AC.** Behavioural assertions of `e2e/admin-flows.spec.ts`, `e2e/versions.spec.ts` green; unit tests of `version-ranges`, `version-diff`, `version-edge` green; baselines regenerated and inspected.

**Verify.** `V-BASE`, `V-E2E e2e/admin-flows.spec.ts e2e/versions.spec.ts e2e/confirm-busy.spec.ts e2e/layout-lint.spec.ts e2e/a11y.spec.ts e2e/ui-v2.spec.ts`.

### T-P3-05 · Reference tables screens · L · Depends: T-P3-04

**Scope.** `src/features/admin/ref-tables/**`.

**Steps.** `RefTableVersionsPage.tsx` uses the shared `PublishForm` (row-diff summary as `children`) and `EndDateForm`; `REF_STATUS_TONE` merges into `shared/versioning/version-status.ts` (add `discarded: 'neutral'`). List / form pages on templates List / Form. `ImportDialog` uses `FileDrop` and `DataGrid` (preview, report). `RowDiffView` on `DataGrid` with `highlight`. The editable `DataGrid.tsx` of this feature is renamed `EditGrid.tsx` (avoid the name clash with `ui/data/DataGrid`), keeps its logic (`grid-model.ts`), uses v3 tokens; it is the single documented exception to "no `<table>` in features" — add it to an `ALLOW` list in `ds-v3.test.ts` with that reason. Remove i18n keys in `ref-tables.json` that duplicate the `common` keys now used by the shared forms and are no longer referenced.

**AC.** Behavioural assertions of `e2e/ref-tables.spec.ts`, `e2e/ref-tables-qa.spec.ts` green; `grid-model` / `ref-model` unit tests green; no file above 400 lines except `grid-model.ts`; baselines regenerated and inspected.

**Verify.** `V-BASE`, `V-E2E e2e/ref-tables.spec.ts e2e/ref-tables-qa.spec.ts e2e/layout-lint.spec.ts e2e/a11y.spec.ts`.

### T-P3-06 · UI text screen · S · Depends: T-P3-03

**Scope.** `src/features/admin/ui-text/**`. Template List: `Toolbar` (search, `Select`, checkbox, count), `DataTable` (100 rows + "show 100 more"), edit `Dialog`, `ConfirmDialog` for reset. Split `UiTextPage.tsx` (621 lines) into `UiTextPage.tsx` + `EditTextDialog.tsx`.

**AC.** Behavioural assertions of `e2e/ui-text.spec.ts`, `e2e/ui-text-qa.spec.ts` green; `ui-text-rules` unit tests green.

**Verify.** `V-BASE`, `V-E2E e2e/ui-text.spec.ts e2e/ui-text-qa.spec.ts e2e/layout-lint.spec.ts e2e/a11y.spec.ts`.

### T-P3-07 · Designer · L · Depends: T-P3-04 · **verify**

**Scope.** `src/features/designer/**`.

**Steps.**
1. Move panels into `src/features/designer/panels/` (`ConfigPanel`, `DataPanel`, `Palette`, `StatusBar`, `ConnectMenu`).
2. Split `forms/NodeForms.tsx` into `src/features/designer/nodes/<group>-<name>.tsx` — one file per entry of its `FORMS` map (13 files, e.g. `input-excel.tsx`, `control-compare.tsx`, `transform-group-by.tsx`, `code-sql.tsx`) — plus `nodes/registry.ts` exporting `NODE_FORMS: Record<string, (p: NodeFormProps) => ReactNode>` and `NodeConfigForm`; shared helpers (`useForm`, `str`, `strs`, `objs`, `bool`, `num`, `resized`, `Section`) go to `nodes/form-helpers.tsx`. Delete `NodeForms.tsx`.
3. Layout: `DesignerEditor.tsx` uses `ui` `SplitPane` — horizontal: palette (collapsible, default 240, min 200) · canvas · config panel (collapsible, default 360, min 320); vertical: canvas over data panel (default 280, min 160, collapsible). Density compact. The data-panel preview table → `ui/data/DataGrid` (sticky header). The sample-file input → `FileDrop compact`.
4. Restyle toolbar, canvas node cards (`canvas/nodes.tsx`), forms (`forms/fields.tsx`, `SlotForm.tsx`, `ParamsForm.tsx`, `formula/*`, `sql/*`) with v3 tokens; `designer.css` uses `--ds-*` variables only. Monaco theme colours read the same variables.
5. First confirm AUD-19 at 1280×800 and 1024×768 with the data panel open; record canvas width / height before and after in the Progress Log.

**AC.** (a) `test ! -f apps/web/src/features/designer/forms/NodeForms.tsx`; 13 form files exist; no designer `.tsx` above 400 lines except `DesignerEditor.tsx` (handled in T-P4-01). (b) At 1280×800 with both side panels collapsed the canvas is ≥ 60 % of the viewport width; with the data panel at its default size the canvas height is ≥ 320 px. (c) Behavioural assertions of all `e2e/designer*.spec.ts`, `e2e/duckdb*.spec.ts`, `e2e/infotip-qa.spec.ts` green. (d) Monaco and React Flow still outside start-up JS (`V-BUDGET` lines).

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E e2e/designer.spec.ts e2e/designer-acceptance.spec.ts e2e/designer-preview.spec.ts e2e/designer-keyboard.spec.ts e2e/designer-keyboard-qa.spec.ts e2e/designer-formula.spec.ts e2e/designer-formula-qa.spec.ts e2e/designer-sql.spec.ts e2e/designer-qa.spec.ts e2e/designer-r4-qa.spec.ts e2e/duckdb.spec.ts e2e/duckdb-qa.spec.ts e2e/infotip-qa.spec.ts e2e/layout-lint.spec.ts e2e/a11y.spec.ts`, then `verifier`.

### T-P3-08 · Remove v2 · M · Depends: T-P3-02, T-P3-05, T-P3-06, T-P3-07 · **verify (end of P3)**

**Steps.**
1. `grep -rn "components/" apps/web/src --include=*.ts --include=*.tsx` must show only files inside `src/components/` → `git rm -r apps/web/src/components`. Move any still-needed test (`frame-components.test.tsx`, `frame-qa.test.tsx`) to `src/ui/__tests__/` rewritten against `ui`, or delete it if `ds-v3` + showcase E2E cover it (state which in the Progress Log).
2. `src/index.css`: delete the v2 `@theme` block and the v2 mobile media query; move `--color-*: initial; --text-*: initial; --radius-*: initial; --shadow-*: initial; --font-weight-*: initial;` into `ui/theme.css` so Tailwind defaults stay removed; delete the `@font-face` blocks for weights 500 and 700; point the scrollbar and base rules at `--ds-*` variables.
3. `V3_SCOPE` becomes `['.']`; delete `design-tokens.test.ts`; the spacing / frame rules it held that are not yet in `ds-v3.test.ts` are ported first (list them in the Progress Log).
4. `eslint.config.js`: delete the `components` zone.
5. `apps/web/bundle-budget.json`: measure CSS (`node apps/web/scripts/check-bundle-size.mjs --measure`), set `cssGzipBytes` to the measured value, `cssBaselineCommit` to this commit, remove `cssLimitGzipBytes` (back to the +10 % rule).
6. Rename `e2e/ui-v2*.spec.ts` → `e2e/ui-screens*.spec.ts` and `e2e/ui-v2-checks.ts` → `e2e/ui-checks.ts`; `git mv` the baseline folders to match `snapshotPathTemplate`; run twice to confirm 0-pixel stability.
7. `docs/MEMORY.md`: move every UI decision superseded by DS v3 (design language v2, type scale, 44 px dense controls, Admin table metrics, colour list, eyebrow, layout-lint details that changed) to `docs/MEMORY-archive.md` with `→ thay bởi <now>`; add one line: `<now> - Toàn bộ màn đã chuyển sang design system v3 (docs/redesign/04-ui-ux-system.md); bỏ token v2 và thư mục components/.`

**AC.** (a) `test ! -d apps/web/src/components`. (b) `grep -rnE "text-(ink|muted|kpi|page-title|title-(md|sm|xs)|caption|eyebrow|dense)|bg-(page|card|neutral|teal|coral|amber|blue)|rounded-(input|card|pill)|shadow-float|h-control" apps/web/src --include=*.tsx` → no output. (c) CSS gzip ≤ T-P2-01 baseline and recorded; start-up JS recorded. (d) Screenshot run passes twice in a row.

**Verify.** `V-BASE`, `V-LOCK`, `V-E2E-FULL` (twice), then `verifier` on P3 (focus: privacy spec, a11y, no behaviour change, every screen has the four states).

---

## P4 — Structural clean-up and close-out

### T-P4-01 · Decompose `DesignerEditor.tsx` · M · Depends: T-P3-08

**Goal.** One component of ≤ 400 lines plus focused hooks (AUD-08).

**Steps.** Create in `src/features/designer/editor/` and move the named pieces (bodies unchanged):

| File | Receives from `DesignerEditor.tsx` |
|------|-----------------------------------|
| `use-canvas-graph.ts` | `built`, `rfNodes`, `edges`, `ariaConfig`, `noteIds`, `onNodesChange`, `onEdgesChange`, `onNodeDragStop`, `onConnect`, `connectByKeyboard`, helper `mergeRf` |
| `use-commands.ts` | `texts`, `centre`, `addAt`, `placeFree`, `deleteSelection`, `copy`, `pasteClip`, `layout`, `addNoteCmd`, `exportJson`, `doUndo`, `doRedo`, `openConnect` |
| `use-draft-save.ts` | `save`, conflict state, `dirty`, `savedJson`, the `useBlocker` wiring |
| `use-shortcuts.ts` | the `keys` ref and the two keyboard `useEffect`s, helpers `onCanvas`, `isEditable`, `inMonaco` |
| `canvas-helpers.ts` | `formatTime`, `subscribeCompact`, `compactNow`, constants |

Each hook takes the document state (`hist`, `setHist`, `apply`) as arguments and returns the callbacks. No logic change.

**AC.** `wc -l apps/web/src/features/designer/DesignerEditor.tsx` ≤ 400; all designer E2E green; no baseline changed.

**Verify.** `V-BASE`, the E2E list of T-P3-07.

### T-P4-02 · Node coverage test · S · Depends: T-P3-07

**Steps.** Create `src/features/designer/__tests__/node-coverage.test.ts` per ADR-006: for every key of `nodePlugins` (import `../../../engine/nodes`): (1) `NODE_TYPES` has an entry of that `type`; (2) its `outputs` and `inputs(defaults)` port names equal the plugin's `outputs` / `inputPorts(config) ?? inputs`; (3) `NODE_FORMS[type]` exists; (4) `designer.json` has `node.<type>.name` and `.description` (use the key shape that exists today — read `Palette.tsx` to confirm it and adjust the skill `add-node` step 5 if the shape differs); (5) `plugin.configSchema.safeParse(defaults(texts))` succeeds for nodes whose defaults are complete (list the exceptions with the reason in the test). Remove any older test that this one fully replaces.

**AC.** Test passes; temporarily deleting one form from `registry.ts` makes it fail naming the node type.

**Verify.** `V-BASE`.

### T-P4-03 · E2E folders and CI smoke job · M · Depends: T-P3-08

**Steps.**
1. `git mv` specs into `e2e/user/` (auth*, auto-logout*, acceptance, cancel, validation-ui, result*, run-*, privacy), `e2e/admin/` (admin-*, versions, ref-tables*, ui-text*, confirm-busy), `e2e/designer/` (designer*, infotip-qa), `e2e/engine/` (duckdb*, heavy*, perf-stages), `e2e/ui/` (a11y, layout-lint.spec, select, pickers, scroll*, ui-*), `e2e/support/` (`fixtures.ts`, `helpers.ts`, `supabase-mock*.ts`, `layout-lint.ts`, `ui-checks.ts`). Fix imports. `snapshotPathTemplate` uses `{testFileName}`, so baseline folders keep working; confirm with one screenshot run.
2. Update the `V-SAFE` macro and E2E paths in this file, `CLAUDE.md`, `.claude/rules/testing.md`, `.claude/skills/*`.
3. `.github/workflows/ci.yml`: add job `e2e-smoke` after `ci`: checkout, pnpm, node 22, `pnpm install --frozen-lockfile`, `npx playwright install --with-deps chromium`, `pnpm --filter @hrflow/web build:e2e`, `npx playwright test e2e/user/acceptance.spec.ts e2e/user/privacy.spec.ts e2e/user/auth.spec.ts --trace off`. (`playwright.config.ts` falls back to Playwright's own Chromium when `/opt/pw-browsers/chromium` is absent.)

**AC.** `npx playwright test --list` shows the same number of tests as before the move (record both); CI run green on the branch.

**Verify.** `V-BASE`, `V-E2E-FULL`.

### T-P4-04 · Close-out · S · Depends: all · **verify (end of P4)**

**Steps.** (1) `verifier` on the full range since `7103d18`. (2) Update `01-current-state-audit.md`: add a "Status after refactor" column (fixed / accepted / backlog) for every AUD row. (3) `README.md`: structure block and status table match the code. (4) Check success criteria S1–S6 of `00-product-vision.md` with their commands; record results. (5) Ask the owner to run the `release` skill (merge to `main`).

**AC.** S1–S6 each recorded as met with evidence, or listed as not met with the reason.

---

## 4. Product backlog (after P4 — not part of the refactor)

Carried over from the archived plan (`docs/archive/PLAN.md` §4, §7) so nothing is lost. Each item starts with the `clarify` skill and gets its own tasks appended here.

| ID | Item | Source | Notes |
|----|------|--------|-------|
| B-01 | Reference tables round 2: node `input.refTable`, version by as-of date, `flow_versions.ref_tables`, User read policy, `fromRefTable` parameter, run log `ref_versions` | PLAN M1; `docs/archive/spec.md` §34 AC-RT-07, 08, 10, 09 | First feature on the new structure; uses skills `add-node`, `db-migration` |
| B-02 | Owner builds 2 real flows; friction log | PLAN M2 | Measures S7 |
| B-03 | Designer ease of use: auto-connect new node, drag from port to add, "create input slot from sample file", "duplicate flow", Vietnamese port labels | PLAN M3 | Workspace part already done in T-P3-07 |
| B-04 | Activity history screen (run logs + audit logs with filters) | PLAN M4 | Adds a "Hệ thống" menu item |
| B-05 | Result screen for flows without `control.compare` | AUD-18 | Confirm in T-P3-02 |
| B-06 | `output.template` (Excel template fill) | PLAN M5 | Needs a real report template from the owner |
| B-07 | Engine MINOR items | AUD-31 | Only when they hurt |
| B-08 | `code.python`, `output.chart`, English UI, dark mode | PLAN §6 | Only when the owner asks |
| B-09 | Owner runs `pnpm perf:local` on the real laptop (AC-B3-24) | PLAN M0.6 | Owner action |

## 5. Assumptions and open questions

| ID | Type | Statement | Needed by |
|----|------|-----------|-----------|
| A-06-1 | ASSUMPTION | Refactor runs before feature work (B-01 waits for P4). The owner's answer "7: Refactor + rebuild the agent system" did not state the order. | Before T-P1-01 |
| A-06-2 | ASSUMPTION | The executor is the main session (Opus, medium effort) with the two subagents of 08; one subagent at a time. | T-P0-02 |
| A-06-3 | ASSUMPTION | The owner accepts a temporary CSS limit of 60 KiB gzip from T-P2-01 to T-P3-08 (overrides the +10 % rule of 2026-11-12 21:14 for that window). | Before T-P2-01 step 9 |
| A-06-4 | ASSUMPTION | The owner accepts that `docs/MEMORY.md` is no longer auto-loaded (ADR-008 A-08-1). | T-P0-02 |
| A-06-5 | ASSUMPTION | New routes `/admin/groups`, `/admin/assignments` and the grouped menu (04 §3) are acceptable without a separate mock-up because GATE-2 shows the List template and the side navigation. | T-P3-03 |
| Q-06-1 | OPEN QUESTION | Order of P3 tasks could put the Designer first if the owner wants to start building flows early. Default: order as written. | Before T-P3-03 |
| Q-06-2 | OPEN QUESTION | E2E smoke in CI needs GitHub Actions minutes once the repo is private (free plan: 2,000 min / month — verify). Default: enable. | T-P4-03 |

## 6. Progress Log

Status values: `todo` · `in progress` · `waiting-owner` · `done` · `blocked`. One row per task; update in the same commit as the work.

| Task ID | Status | Date | Notes (numbers measured at completion: tests, start-up JS KiB, CSS KiB, subagent tokens) |
|---------|--------|------|-----------------------------------------------------------------------------------------|
| T-P0-01 | todo | | |
| T-P0-02 | todo | | |
| T-P0-03 | todo | | |
| T-P0-04 | todo | | |
| T-P0-05 | todo | | |
| T-P1-01 | todo | | |
| T-P1-02 | todo | | |
| T-P1-03 | todo | | |
| T-P1-04 | todo | | |
| T-P1-05 | todo | | |
| T-P2-01 | todo | | |
| T-P2-02 | todo | | |
| T-P2-03 | todo | | GATE-1 |
| T-P2-04 | todo | | |
| T-P2-05 | todo | | |
| T-P2-06 | todo | | |
| T-P2-07 | todo | | |
| T-P2-08 | todo | | |
| T-P2-09 | todo | | |
| T-P2-10 | todo | | GATE-2 |
| T-P3-01 | todo | | |
| T-P3-02 | todo | | |
| T-P3-03 | todo | | |
| T-P3-04 | todo | | |
| T-P3-05 | todo | | |
| T-P3-06 | todo | | |
| T-P3-07 | todo | | |
| T-P3-08 | todo | | |
| T-P4-01 | todo | | |
| T-P4-02 | todo | | |
| T-P4-03 | todo | | |
| T-P4-04 | todo | | |

Baseline at `7103d18` (2026-11-13): unit tests 1,348 passed / 4 expected-fail / 12 skipped; E2E 517 tests in 52 files as listed by `npx playwright test --list` (includes opt-in heavy tests; full run not repeated in the audit, last recorded full run: 509 passed); start-up JS 214.6 KiB gzip; CSS 38.5 KiB gzip; 52 screenshot baselines.
