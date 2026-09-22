#!/usr/bin/env bash
# db-guard.sh — wraps any command that writes to the database and refuses to run it
# unless DATABASE_URL resolves to the test sandbox DB.
#
# Why this exists: during a manual QA session, `source .env.production.local` (a file with
# bare VAR=value, no `export`) set DATABASE_URL as a local shell variable only. It never
# reached the child process's environment, so the next command's own dotenv loader silently
# fell back to `.env` — the REAL demo database — and a seed script wrote a throwaway tenant
# and superadmin user there. Caught and cleaned up immediately, but a purely manual "remember
# to check" discipline is exactly the kind of thing that fails again under time pressure.
# This makes the check structural instead: no DATABASE_URL, or a DATABASE_URL that doesn't
# obviously point at the test sandbox, and the wrapped command never runs at all.
#
# Usage:
#   export DATABASE_URL="postgresql://user:pass@host:5432/manualtest_sandbox_never_prod"
#   scripts/db-guard.sh npx tsx prisma/seed-superadmin.ts
#   scripts/db-guard.sh npx prisma migrate dev
#   scripts/db-guard.sh psql "$DATABASE_URL" -c "select 1"
#
# The test sandbox DB name is deliberately unrelated to the real DB's name (no shared
# substring with "pathelix_fleet") specifically so no truncation/typo/fallback bug can
# accidentally produce a string that passes this check. See .env.sandbox.local (formerly .env.production.local, renamed 2026-09-22 for clarity).

set -euo pipefail

EXPECTED_MARKER="manualtest_sandbox"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <command to run with a verified test DATABASE_URL>" >&2
  exit 2
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DB GUARD: DATABASE_URL is not set in this shell's environment." >&2
  echo "   This guard does NOT read env files for you — that ambiguity is the exact bug" >&2
  echo "   it exists to prevent. Export it explicitly first, e.g.:" >&2
  echo "     export DATABASE_URL=\$(grep '^DATABASE_URL=' .env.sandbox.local | cut -d= -f2-)" >&2
  exit 1
fi

DB_NAME="${DATABASE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"

if [[ "$DB_NAME" != *"$EXPECTED_MARKER"* ]]; then
  echo "❌ DB GUARD: refusing to run — DATABASE_URL does not point at the test sandbox." >&2
  echo "   Resolved database name: '$DB_NAME'" >&2
  echo "   Expected it to contain: '$EXPECTED_MARKER'" >&2
  echo "   Command NOT executed: $*" >&2
  exit 1
fi

echo "✅ DB GUARD: writing to database '$DB_NAME' — confirmed test sandbox. Running: $*"
exec "$@"
