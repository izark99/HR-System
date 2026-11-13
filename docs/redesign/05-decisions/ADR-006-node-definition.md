# ADR-006 — Node types: fixed file set, one registry per side, completeness test

Status: Accepted · 2026-11-13

## Context

AUD-11: a node type is spread over the schema package, the engine plugin and its registry, the
Designer catalog, a 1,079-line form file (`NodeForms.tsx` with a `FORMS` map), issue texts and the
locale file. The engine must stay out of the main-thread chunks and must not import React, so the
engine side and the Designer side cannot live in one module.

## Options

| Option | Notes |
|--------|-------|
| A. Keep as is | Every new node repeats the hunt; nothing checks completeness |
| B. One folder per node holding schema + plugin + form | Crosses the package boundary and the worker / main-thread boundary; needs build tricks to keep React out of the worker |
| C. Keep the three homes (schema package, engine plugin, Designer), make each a **one-file-per-node** folder with a registry, and add one test that fails when any part is missing | No build change; adding a node is a checklist the test enforces |

## Decision

**Option C.**

| Part | Location | One file per node |
|------|----------|-------------------|
| Config schema | `packages/flow-schema/src/` (`nodes.ts`, `transforms.ts`) | existing layout kept |
| Engine plugin | `src/engine/nodes/<group>-<name>.ts`, registered in `src/engine/nodes/index.ts` | yes (exists) |
| Designer catalog entry | `src/features/designer/catalog.ts` (`NODE_TYPES`) | one entry |
| Designer form | `src/features/designer/nodes/<group>-<name>.tsx`, registered in `nodes/registry.ts` | yes (split from `NodeForms.tsx`) |
| Texts | `src/locales/vi/designer.json` keys `node.<type>.*` | one block |

`src/features/designer/__tests__/node-coverage.test.ts` asserts, for every key of `nodePlugins`:
catalog entry exists with the same ports, form is registered, name + description texts exist, the
config schema parses the catalog `defaults()`. The procedure is the `add-node` skill.

## Consequences

- `NodeForms.tsx` disappears (T-P3-07); each form file is 30–150 lines.
- Adding a node type = 5 known places; the test names the missing one.
- The test imports `engine/nodes` (test files may import engine internals of their own app; the zone rule exempts `__tests__`).
