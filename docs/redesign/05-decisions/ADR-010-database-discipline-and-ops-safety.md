# ADR-010 — Database migration discipline and operational safety

Status: Accepted · 2026-11-13

## Context

AUD-01: the six migration files were applied with ad-hoc SQL; the migration-history table is empty.
AUD-02: `rls.sql` and `versions.sql` never ran on the real DB; the backup workflow never ran.
AUD-03: the repository is public. AUD-21: E2E mocks Supabase; `database.types.ts` is hand-written.
Project pitfall: through the Supabase MCP connection, SQL containing `drop` or `delete` hangs for
60 s and is cancelled.

## Options

| Topic | Option | Notes |
|-------|--------|-------|
| History | A. Leave empty | Drift stays invisible |
| | B. Record the six files as applied (metadata rows only); apply future migrations with the tool that records history | Reversible; no schema effect |
| | C. Rebuild the DB from migrations | Needs export / import of production rows; unnecessary risk |
| Real-DB tests | A. Local Postgres only | Misses Supabase default grants |
| | B. Run every `supabase/tests/*.sql` (each `begin … rollback`) on the real DB through the existing `db-tests.yml` before any DB change reaches `main` | Uses existing workflow |
| Contract | A. Trust hand-written types | Drift possible |
| | B. Diff generated types against `database.types.ts` at each migration | Manual step in the `db-migration` skill; no new tooling |
| | C. Full integration test against a second Supabase project | A second free project is possible but doubles keep-alive / migration work |

## Decision

History **B**, real-DB tests **B**, contract **B**.

1. T-P0-03 (owner + executor): add secrets `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`; run "Database tests on Supabase" and "Supabase backup"; make the repo private; turn on leaked-password protection if the plan allows it.
2. T-P0-04: record the six migrations in the history table; compare generated types.
3. From then on (skill `db-migration`): a migration is one new file; applied with the Supabase MCP `apply_migration` (records history); statements containing `drop` / `delete` are given to the owner as a SQL block for the dashboard SQL editor, and the history row is recorded the same way; `revoke all … from public, anon, authenticated` before grants on every new table; SQL test file; real-DB test run; security advisor; types diff.
4. A green `backup.yml` run (includes restore verification into a scratch DB built from `supabase/migrations/`) is required before any migration that rewrites existing rows.

## Consequences

- Schema drift becomes visible in two ways: migration history, and the backup job's restore check.
- No migration is part of the refactor itself.
- A second Supabase project (contract option C) is reconsidered only if a client ↔ DB mismatch reaches production once.
- The weekly backup artifact is encrypted; losing `BACKUP_PASSPHRASE` makes backups unreadable — the owner keeps it outside GitHub.

| ID | Type | Statement |
|----|------|-----------|
| A-10-1 | ASSUMPTION | The history table is `supabase_migrations.schema_migrations(version, name, statements)`; T-P0-04 inspects it before writing. |
| A-10-2 | ASSUMPTION | "Leaked password protection" may not be available on the Free plan (**UNVERIFIED**); if not, the WARN is accepted and logged. |
