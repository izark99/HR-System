#!/usr/bin/env bash
# Runs every supabase/tests/*.sql against a database (docs/PLAN.md M0.1): the RLS, version,
# reference table and UI text tests. Meant for the REAL Supabase project, where a local stand-in
# cannot prove the privileges (Supabase grants its own defaults).
#
# Safe on a live database because each test file is one transaction that ends with ROLLBACK and
# uses fake accounts only. This script refuses a file that is not shaped that way.
#
# Prints one line per file and, on failure, the error lines only (never result rows).
#
#   DB_URL    database to test (Supabase: the "Session pooler" connection string)
#   REPO_DIR  repository root (default: one level above this script)
set -uo pipefail

: "${DB_URL:?DB_URL is not set}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

status=0
for file in "$REPO_DIR"/supabase/tests/*.sql; do
  name="$(basename "$file")"
  statements="$(grep -v -E '^[[:space:]]*(--.*)?$' "$file")"
  first="$(head -n 1 <<<"$statements" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  last="$(tail -n 1 <<<"$statements" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  if [ "$first" != "begin;" ] || [ "$last" != "rollback;" ] ||
    grep -q -i -E '^[[:space:]]*commit[[:space:]]*;' <<<"$statements"; then
    echo "db-tests: FAIL $name must start with BEGIN, end with ROLLBACK and never COMMIT; not run"
    status=1
    continue
  fi
  if output="$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB_URL" -f "$file" 2>&1)"; then
    echo "db-tests: OK   $name ($(tail -n 1 <<<"$output"))"
  else
    echo "db-tests: FAIL $name"
    grep -E 'ERROR|FAIL|FATAL' <<<"$output" | head -n 5 | sed 's/^/    /'
    status=1
  fi
done
exit "$status"
