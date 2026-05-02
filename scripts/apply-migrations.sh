#!/usr/bin/env bash
# Apply every migration in `db/supabase/` then `db/schema/` in numeric order.
# Idempotent — every migration uses IF NOT EXISTS guards.
#
# Usage:
#   scripts/apply-migrations.sh "$DATABASE_URL"
#
# CI: see .github/workflows/ci.yml
set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo "Usage: $0 <DATABASE_URL>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

apply_dir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then return; fi
  echo "── Applying migrations in $dir"
  # Sort by leading numeric prefix; ignore the bundle file (00_full_init.sql).
  while IFS= read -r f; do
    case "$(basename "$f")" in
      00_full_init.sql) continue ;;
    esac
    echo "  → $(basename "$f")"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done < <(find "$dir" -maxdepth 1 -type f -name '*.sql' | sort)
}

apply_dir "$ROOT/db/supabase"
apply_dir "$ROOT/db/schema"

echo "✅ All migrations applied."
