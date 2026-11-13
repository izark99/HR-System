# ADR-007 — Versioned resources: share the UI, keep the SQL separate

Status: Accepted · 2026-11-13

## Context

Flows and reference tables have the same lifecycle (draft → published → retired, effective range,
no overlap, immutable once published). AUD-09: `PublishForm` and `EndDateForm` are implemented twice
(≈ 280 lines each); the publish RPCs have identical parameter lists
`(id, effective_from, effective_to, change_note, close_previous, expected_updated_at)`.
AUD-10: the SQL guard triggers and RPCs are also written twice. A third versioned resource
(Excel templates) is on the product backlog.

## Options

| Option | Notes |
|--------|-------|
| A. Leave both duplicated | Third copy will follow with templates |
| B. Share UI and client helpers; leave SQL duplicated | No DB change, no risk to production data |
| C. Also unify SQL into generic helpers / one `versions` table | Touches immutable published data and RLS on a live DB; `drop`/`delete` statements cannot run through the MCP connection (project pitfall); gain is small |

## Decision

**Option B.** `src/shared/versioning/` holds:

| File | Content |
|------|---------|
| `as-of.ts` | moved from `features/runner/as-of.ts` |
| `version-status.ts` | `VersionStatus`, tone map (moved from `FlowVersionsPage.tsx` `VERSION_STATUS_TONE`), label keys |
| `version-ranges.ts` | moved from `features/admin/versions/version-ranges.ts` |
| `PublishForm.tsx` | Owns the state both current forms own: `from` (default: first day of the current month), `to`, `note`, `closePrevious`, field errors, error, busy; computes the previous open version and new gaps with `version-ranges.ts`. Props: `draft: { id: string; versionNo: number }`, `versions: RangeVersion[]`, `blocked?: boolean` (submit disabled, e.g. design problems), `children?: ReactNode` (resource-specific block above the fields: design-check problems for flows, row-diff summary for reference tables), `publish(input: { effectiveFrom: string; effectiveTo: string \| null; changeNote: string; closePrevious: boolean }): Promise<{ versionNo: number }>`, `onDone(versionNo: number, effectiveFrom: string)`, `onConflict()` |
| `EndDateForm.tsx` | Props: `version: RangeVersion`, `versions: RangeVersion[]`, `save(effectiveTo: string \| null): Promise<void>`, `onDone()` |

Texts: the shared forms use the `common` i18n keys the flow forms use today (keys are not renamed, so
existing UI-text overrides keep working); duplicate keys in `ref-tables.json` are removed when no
longer referenced.

SQL stays as is. When templates arrive they copy the SQL pattern of `ref_table_versions` and reuse
the shared UI.

## Consequences

- Both versions pages shrink by ≈ 280 lines each (T-P3-04, T-P3-05).
- The half-open range rule and overlap check exist once on the client (`version-ranges.ts`) and once per table in SQL; a change to the rule must change all three and their tests (`supabase/tests/versions.sql`, `ref_tables.sql`).
- Revisit Option C only when a fourth versioned resource appears.
