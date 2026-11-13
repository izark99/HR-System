# ADR-008 — Documentation consolidation and source of truth

Status: Accepted · 2026-11-13 (owner answer 6B)

## Context

AUD-24: six instruction layers (`CLAUDE.md`, `docs/MEMORY.md`, `docs/PLAN.md`, `docs/HANDOFF.md`,
`docs/spec.md`, nine rule files) overlap and contain stale facts. `docs/spec.md` (1,804 lines) mixes
specification (§1–§25) with per-round acceptance criteria (§26–§34).

## Options

| Option | Notes |
|--------|-------|
| A. Add `docs/redesign/` beside everything else | A seventh layer |
| B. `docs/redesign/` replaces spec, PLAN and HANDOFF; old files frozen in `docs/archive/`; `MEMORY.md` stays as the decision journal | One design source; old detail still reachable |
| C. Delete the old documents | Loses node-level behaviour reference and history |

## Decision

**Option B.**

| Document | Role | Language | Loaded |
|----------|------|----------|--------|
| `CLAUDE.md` | Operating manual: commands, non-negotiables, pointers | English | Every session (kept short) |
| `docs/redesign/00…08`, `05-decisions/` | Design source of truth | English | On demand, by task reference |
| `docs/redesign/06-refactor-plan.md` | Plan + Progress Log (replaces PLAN and HANDOFF) | English | Start of every execution session |
| `docs/MEMORY.md` | Owner decision journal, append-only | Vietnamese | **On demand** (grep by topic) — no longer imported by `CLAUDE.md` |
| `docs/MEMORY-archive.md` | Superseded decisions | Vietnamese | Rarely |
| `docs/archive/*` | Frozen reference: `spec.md` (node behaviour §8–§14, §24, §27, §34; glossary §25.4), `PLAN.md`, `HANDOFF.md`, `design-reference.md`, `patches/` | Vietnamese | Only when a task cites a section |
| `README.md` | Human overview, setup, backup / restore | Vietnamese | — |

Precedence on conflict: **`docs/MEMORY.md` > `docs/redesign/` > code > `docs/archive/`**.
A new owner decision is written to `MEMORY.md` first and the affected redesign document is updated
in the same commit.

## Consequences

- Code comments that cite `spec §N` (423 occurrences) now mean `docs/archive/spec.md §N`; they are not rewritten.
- Chat with the owner stays Vietnamese; repository documents written from now on are English except `MEMORY.md` and `README.md`.
- `MEMORY.md` is no longer in every session's context. Mitigation: durable rules are restated in `CLAUDE.md`, `.claude/rules/*` and the redesign documents; every plan task cites the decisions it depends on; the `clarify` skill greps `MEMORY.md` before proposing anything. **Owner confirmation requested** (A-08-1).
- Status facts (counts, what is done) live only in the Progress Log; no second status document.

| ID | Type | Statement |
|----|------|-----------|
| A-08-1 | ASSUMPTION | The owner accepts that `MEMORY.md` is consulted on demand instead of auto-loaded (Claude Code guidance: imports do not reduce context cost; target < 200 lines per always-loaded file). |
