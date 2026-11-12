#!/usr/bin/env bash
# Weekly backup of the Supabase database (spec §16, docs/PLAN.md M0.2).
#
# 1. Dumps the DATA of schema `public` of the source database (flows, versions, reference tables,
#    edited UI texts, accounts' profiles, groups, logs). The structure is not dumped: it lives in
#    supabase/migrations/. Supabase's own schemas (auth, storage…) are not dumped, so no password
#    hash ever leaves the project; accounts are recreated by hand after a disaster.
# 2. Proves the dump can be restored: builds a scratch database from the repository's migrations,
#    loads the dump into it and compares the row count of every table with the source. A table or
#    column that exists in the source but not in the migrations makes the load fail, which also
#    reveals a database that drifted away from supabase/migrations/.
#
# The dump is plain SQL and contains personal data of the accounts (username, full name). The
# caller encrypts it before it is stored anywhere; this script never prints row contents, only
# table names and counts.
#
# Needs pg_dump and psql at least as new as the source server.
#
#   SOURCE_DB_URL   database to back up (Supabase: the "Session pooler" connection string)
#   SCRATCH_DB_URL  an EMPTY throw-away database on a plain PostgreSQL server (it gets filled)
#   OUT_FILE        where to write the dump
#   REPO_DIR        repository root (default: two levels above this script)
set -euo pipefail

: "${SOURCE_DB_URL:?SOURCE_DB_URL is not set}"
: "${SCRATCH_DB_URL:?SCRATCH_DB_URL is not set}"
: "${OUT_FILE:?OUT_FILE is not set}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

q() { psql -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
# Scratch database only: hide notices ("… does not exist, skipping"); warnings and errors still
# show. Not used for the source: a connection pooler may refuse start-up options.
qs() { PGOPTIONS="-c client_min_messages=warning" q -d "$SCRATCH_DB_URL" "$@"; }

# Row count of every table of schema public, one "table count" per line, sorted by name.
counts() {
  local url="$1" table
  for table in $(q -d "$url" -c \
    "select tablename from pg_tables where schemaname = 'public' order by tablename"); do
    echo "$table $(q -d "$url" -c "select count(*) from public.\"$table\"")"
  done
}

echo "backup: dumping the data of schema public"
umask 077
pg_dump --data-only --schema=public --no-owner --no-privileges -d "$SOURCE_DB_URL" -f "$OUT_FILE"
test -s "$OUT_FILE"

echo "backup: building the scratch database from supabase/migrations"
if [ "$(qs -c "select count(*) from pg_tables where schemaname = 'public'")" != 0 ]; then
  echo "backup: FAIL the scratch database is not empty" >&2
  exit 1
fi
qs -f "$REPO_DIR/supabase/tests/support/supabase_stub.sql" >/dev/null
for migration in "$REPO_DIR"/supabase/migrations/*.sql; do
  qs -f "$migration" >/dev/null
done

echo "backup: loading the dump into the scratch database"
# Migrations insert a few default rows (e.g. app_settings); empty every table first. Triggers and
# foreign keys are off while loading (session_replication_role), as in any data-only restore.
tables="$(qs -c \
  "select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public'")"
{
  echo "set session_replication_role = replica;"
  echo "truncate table $tables;"
  cat "$OUT_FILE"
} | qs --single-transaction >/dev/null

echo "backup: comparing row counts (source / restored)"
source_counts="$(counts "$SOURCE_DB_URL")"
restored_counts="$(counts "$SCRATCH_DB_URL")"
failed=0
while read -r table count; do
  restored="$(awk -v t="$table" '$1 == t { print $2 }' <<<"$restored_counts")"
  if [ "$count" = "$restored" ]; then
    echo "backup: OK   $table $count"
  else
    echo "backup: FAIL $table source $count, restored ${restored:-missing}" >&2
    failed=1
  fi
done <<<"$source_counts"
if [ "$failed" != 0 ]; then
  exit 1
fi
if [ "$(wc -l <<<"$source_counts")" != "$(wc -l <<<"$restored_counts")" ]; then
  echo "backup: FAIL the migrations create tables that the source does not have" >&2
  exit 1
fi
echo "backup: dump verified ($(wc -l <<<"$source_counts") tables)"
