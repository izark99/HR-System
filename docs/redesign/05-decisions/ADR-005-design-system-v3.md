# ADR-005 — Design System v3: semantic tokens, two densities, closed component API

Status: Accepted · 2026-11-13 (owner answer 5C). Visual values confirmed at GATE-1.

## Context

Owner request: one shared system so future work reuses it, does not drift, and is not re-coded.
Audit: tokens are one flat tier named by colour (AUD-15); density is handled by 14 allow-listed
exceptions and `dense*` class strings; `components/ui.tsx` exports raw class strings that features
assemble by hand; 6 popover implementations (AUD-12), 9 table implementations (AUD-13), 4 raw file
inputs (AUD-14); five rounds of layout fixes in the past (`docs/archive/HANDOFF.md` §6).

## Options

| Option | Notes |
|--------|-------|
| A. Keep v2, add missing components | Cheapest; the causes of drift (literal tokens, class strings, dense exceptions) stay |
| B. Adopt a component library (shadcn/ui + Radix, Mantine, MUI) | Large new dependency surface; restyling to Vietnamese-first, CSP and bundle limits; replaces tested in-house logic (Select, pickers, Menu) |
| C. DS v3 in-house: three token tiers, semantic names, density mode, `ui/` components with no `className` escape hatch, guard test; built beside v2 and migrated screen by screen | No new runtime dependency; keeps tested logic; requires a migration window |

## Decision

**Option C**, specified in `../04-ui-ux-system.md`.

1. Tokens: `primitives.css` → `semantic.css` → `density.css`, exposed through `@theme inline` in `ui/theme.css`. Features can only reach semantic utilities.
2. Density: `data-density="comfortable|compact"` on a layout container. User screens comfortable; Admin and Designer compact.
3. Components: `src/ui/` with a public barrel. No class-string exports. No `className` prop except four layout primitives. One `Popover`, one `DataTable`, one `DataGrid`, one `FileDrop`.
4. Enforcement: `ds-v3.test.ts` over a growing `v3-scope.ts`; ESLint zones; `layout-lint`; 0-pixel screenshot baselines regenerated per migrated screen group.
5. Hue families and typeface are kept for now (D-04-2); palette / font / positive-colour questions are settled at GATE-1 on a live showcase, where a change costs one file.
6. Approval gates: **GATE-1** after tokens + first primitives (T-P2-03); **GATE-2** after the full component set (T-P2-10). No screen is migrated before GATE-2.

## Consequences

- v2 and v3 coexist from T-P2-01 to T-P3-08. CSS budget is raised to **60 KiB gzip** for that window and reset to (measured v3 size × 1.10) in T-P3-08. This temporarily overrides the "+10 % CSS" rule of 2026-11-12 21:14 — **needs the owner's confirmation** (A-06-3).
- Start-up JS limit (240 KiB) is **not** raised: the entry-route screens migrate together in one task (T-P3-01) so both component sets never sit in the entry chunk at once.
- All screenshot baselines and v2-value assertions in `e2e/ui-v2*.spec.ts`, `e2e/ui-frame*.spec.ts`, `e2e/ui-final-qa.spec.ts`, `e2e/ui-v2-checks.ts` are rewritten to v3 values as screens migrate. Behavioural assertions are not touched.
- About 40 UI decisions in `docs/MEMORY.md` become superseded; they are moved to the archive in T-P3-08, not before (they still describe unmigrated screens).
- Font files for weights 500 and 700 are dropped (4 fewer woff2 files).
