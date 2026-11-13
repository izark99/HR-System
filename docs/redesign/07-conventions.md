# 07 — Conventions

> Applies to all new and migrated code. Where existing code differs, it is brought in line only
> when a task touches it. `src/` means `apps/web/src/`.

## 1. Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| React component file | `PascalCase.tsx`, one exported component per file (small private helpers allowed) | `UsersPage.tsx` |
| Other TS file | `kebab-case.ts` | `use-resource.ts`, `flows-api.ts` |
| Hook | `use-<name>.ts`, export `use<Name>` | `use-draft-save.ts` |
| Test | `<name>.test.ts(x)` beside the file or in `__tests__/` of the same folder | `version-ranges.test.ts` |
| E2E spec | `e2e/<area>/<topic>.spec.ts` | `e2e/admin/users.spec.ts` |
| Page component | suffix `Page` | `FlowVersionsPage` |
| Dialog component | suffix `Dialog` | `CreateUserDialog` |
| API module | `<resource>-api.ts`; functions are verbs | `listUsers`, `publishDraft` |
| Node type id | `<group>.<camelName>` | `transform.groupBy` |
| Node plugin file / form file | `<group>-<kebab-name>.ts(x)` | `transform-group-by.ts` |
| i18n key | `camelCase` segments, namespace per area | `admin.users.create.title` |
| DB object | `snake_case`; RPC for admins prefixed `admin_`; helper functions in schema `private` | `admin_publish_flow_draft` |
| Migration | `<UTC yyyymmddhhmmss>_<snake_name>.sql` | `20261201090000_flow_ref_tables.sql` |
| CSS token | `--p-*` primitive, `--ds-*` semantic / density | `--ds-ctl-h` |
| Types | `PascalCase`; no `I` prefix; unions over enums | `VersionStatus` |
| Constants | `SCREAMING_SNAKE_CASE` for module constants | `IDLE_LIMIT_MS` |

## 2. Folder rules

- Layers and allowed imports: `02-target-architecture.md` §2–§3 (lint-enforced).
- A file used by two features moves to `shared/`; a visual part with no app knowledge moves to `ui/`.
- No barrel files except `ui/index.ts` and `ui/layout/…` re-exports inside `ui`. Import from the file that defines the symbol.
- Relative imports only; no path alias.
- A feature folder owns its pages, its components, its store. Sub-folders appear when a folder passes ~12 files.
- File size: a `.tsx` file above **400 lines** or a component with more than **8 `useState`** is split before more is added to it (dialogs into their own files, data loading into a hook).

## 3. TypeScript and React style

- `strict` TypeScript; no `any`, no `@ts-ignore`; `import type` for types (lint).
- Function components and hooks only. Props are an inline type or `interface <Name>Props`.
- No default exports (exception: none; lazy routes use `lazyRouteComponent(() => import(...), 'Name')`).
- Derive, do not store: no state that can be computed from props or other state.
- Effects only for synchronising with something outside React (worker, timers, DOM). Data loading uses `useResource`.
- Comments explain *why*; no commented-out code; no TODO without an entry in the plan backlog.
- Prettier formats (`singleQuote`, width 100, trailing commas). ESLint must pass with 0 warnings added.

## 4. State management

| Need | Use |
|------|-----|
| Load server data for a screen | `useResource(loader)` |
| Write then refresh | call `api.*`, then `reload()`; show result with toast / `Callout` |
| Cross-screen session state | existing stores (`AuthService`, `RunStore`) via context |
| Form / dialog | local state inside the dialog component |
| Anything persistent in the browser | not allowed (only the auth session in `sessionStorage`) |

## 5. API conventions (`src/api/`)

```ts
// shape of every module (same as today's AdminApi / RefTablesApi, one class per resource)
export class GroupsApi {
  constructor(private readonly sb: GroupsClient) {}        // GroupsClient = Pick<Supabase, 'from'>: fakeable in tests
  async list(): Promise<Group[]> { … }
  async create(name: string, description: string): Promise<void> { … }
}
// api/client.ts
export function getApi(): Api { … }   // lazily built { users, groups, assignments, flows, refTables, uiText, runs }
```

- Input and output types are app types (camelCase), mapped from DB rows inside the module. DB row types never leave `api/`.
- No method returns `{ data, error }`; it returns data or throws `ApiError`.
- Mutations of versioned resources send `expectedUpdatedAt` (optimistic lock); a conflict is `ApiError { key: 'conflict' }`.
- Admin-only operations go through `admin_*` RPCs or the `admin-users` Edge Function; never a direct table write that bypasses a guard.
- Edge Function contract: `POST` JSON `{ action, … }` → `{ ok: true, data }` or `{ ok: false, code }` with an HTTP status from its table (`handler.ts`).

## 6. Error format

```ts
class ApiError extends Error { key: ApiErrorKey }                       // api
interface EngineErrorInfo { messageKey: string; params: Record<string, unknown>; nodeId?: string }   // engine → UI
```

- `ApiErrorKey` is a closed union in `api/errors.ts`. Texts keep their existing i18n keys (`common:admin.errors.<key>`, `refTables:errors.<key>`; lookup helper `apiErrorText(key)` in `api/errors.ts`). `FlowSourceError { kind: 'network' | 'server' }` of the run screens is kept as is.
- Unknown server errors map to `unknown`; the raw message is never shown and never logged with data.
- Engine errors carry keys and params only; params may contain column titles, sheet names, row numbers, counts — not cell values, except in the on-screen validation report.

## 7. i18n and copy

- All UI text in `src/locales/vi/<namespace>.json`; `t('key', { vars })`; variables in `{{…}}` must match between default and override.
- Sentence case. No trailing period on labels and buttons. Buttons are verbs.
- Do not rename an existing key (owner overrides are keyed by it); add a new key instead and remove unused ones in the same commit (key tests: `engine/__tests__/i18n-keys.test.ts`, `features/designer/__tests__/i18n-keys.test.ts`).

## 8. Testing rules

| Code | Must have |
|------|-----------|
| Engine node, parser, validator, decimal / key logic | Unit tests incl. edge cases; golden / integration unchanged |
| `ui/logic/*`, `shared/versioning/*`, `shared/hooks/*`, `api/errors.ts`, each `api/*-api.ts` | Unit tests with a fake client |
| New `ui` component | Appears in the showcase page; covered by `ds-v3.test.ts`, axe and `layout-lint` on the showcase |
| New screen | E2E for the main path + error state; added to `layout-lint`; at most 2 screenshot baselines |
| RLS policy / RPC | SQL test in `supabase/tests/` (`begin … rollback`), run on the real DB |
| Bug fix | A test that fails before the fix |

Not required: tests of pure presentation, snapshot tests of markup.

## 9. Commits and branches

- Conventional Commits, English: `type(scope): subject` with `type` ∈ `feat | fix | refactor | test | docs | build | ci | chore`.
- Plan tasks put the task ID in the subject: `refactor(api): T-P1-01 move Supabase access into src/api`.
- One purpose per commit; a move-only commit contains no content change (so `git log --follow` works).
- Never commit with failing lint, typecheck or unit tests. Never commit secrets or the company name.
- Work on a feature branch; `main` moves only through the `release` skill.

## 10. Definition of done (every task)

1. Acceptance criteria of the task met.
2. `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` exit 0.
3. UI / worker change: `pnpm --filter @hrflow/web build:e2e` then the listed E2E specs pass with `--trace off`.
4. Documents made wrong by the change are fixed in the same commit.
5. Progress Log updated; commit pushed.

## 11. Decisions, assumptions, open questions

| ID | Type | Statement |
|----|------|-----------|
| D-07-1 | DECISION | Limits of 400 lines per `.tsx` file and 8 `useState` per component are review rules, not lint rules. |
| D-07-2 | DECISION | Existing i18n keys are never renamed. |
| Q-07-1 | OPEN QUESTION | None. |
