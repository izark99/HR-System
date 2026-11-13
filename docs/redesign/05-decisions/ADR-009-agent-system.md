# ADR-009 — Agent system rebuilt on Claude Code guidance

Status: Accepted · 2026-11-13 (owner answer 7). Full specification: `../08-agent-system.md`.

## Context

AUD-25. Current setup: `CLAUDE.md` imports the 356-line `docs/MEMORY.md`; six always-loaded rule
files plus three path-scoped ones; two subagents (`developer`, `verifier`) with full edit tools; one
skill (`clarify`); no `.claude/settings.json`, no hooks. Rules that must never be broken (never edit
an applied migration, verifier writes tests only, never read `.env.local`) are prompt text.
Recorded cost: ≈ 6.8 M subagent tokens, three rounds stopped by the usage limit, two sessions that
did the same work.

Guidance used (Claude Code docs, read 2026-11-13: *Best practices*, *How Claude remembers your
project*, *Custom subagents*, *Hooks guide*):

| Guidance | Applied as |
|----------|-----------|
| Keep `CLAUDE.md` short (target < 200 lines); `@` imports do not reduce context cost | New `CLAUDE.md` ≈ 90 lines, no import of `MEMORY.md` |
| Rules for one part of the codebase go in `.claude/rules/` with `paths:` | 1 always-loaded rule file, 5 path-scoped |
| Multi-step procedures go in skills (loaded on demand) | 6 skills |
| A rule with zero exceptions is a hook or a `deny` permission, not a sentence | `.claude/settings.json`: 3 deny rules, 2 `PreToolUse` hooks, 1 `PostToolUse` hook |
| Give Claude a check to run; ask for evidence | Every plan task lists verification commands; reports quote command + result |
| Subagents: focused, limited tools, fresh context for review; they cost tokens | 2 subagents, used only where the plan says; verifier restricted by hook |
| Reviewer prompt should "skip style" | In the verifier definition |
| `/clear` between unrelated tasks | One plan task per session |

## Options

| Option | Notes |
|--------|-------|
| A. Keep current system, edit text | Does not fix context weight or prompt-only enforcement |
| B. Rebuild: short manual + path rules + skills + hooks + 2 subagents + Progress Log as the only state | Matches guidance; small |
| C. Larger team (planner, architect, UI, DB, QA agents) or parallel worktree agents | More tokens and coordination; conflicts with the owner's usage limit and the "one subagent at a time" rule |

## Decision

**Option B.**

- **State** lives in one place: the Progress Log in `06-refactor-plan.md`. A session starts by reading it and ends by updating it.
- **Main session** executes S and M tasks itself. **`implementer`** subagent is used only for tasks marked L (context isolation). **`verifier`** subagent runs at the end of every phase and after every task marked "verify", in a fresh context, read-and-test only.
- One subagent at a time (owner's usage limit; kept from 2026-10-28).
- **Deterministic guards** (08 §6): edits blocked on released migration files, `vendor/`, `docs/archive/` and env files; the verifier may write only test / fixture / E2E files; Prettier runs after each edit; `.env.local` is unreadable.
- Language: instructions in English; conversation with the owner in Vietnamese, questions as numbered A/B/C options with one recommended.

## Consequences

- `docs/MEMORY.md` is consulted by grep, not auto-loaded (ADR-008, A-08-1).
- Existing decisions about the agent team (2026-10-30 12:51, 2026-10-28 07:46) are superseded when T-P0-02 lands; T-P0-02 moves them to the archive and records the new line.
- Hooks need `jq` and `bash` (both present in the cloud environment; verified 2026-11-13). On another machine without `jq` the hook fails closed for protected paths.
- If a hook proves too strict, the fix is to edit the hook in a reviewed commit, never to bypass it.
