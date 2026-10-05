#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$acceptance_dir/.env.identity-acceptance"
test -f "$env_file" || { echo "Missing $env_file" >&2; exit 1; }
node "$acceptance_dir/validate-env.mjs" "$env_file"
if [[ "${1:-}" == "--purge-isolated-data" ]]; then
  read -r -p "Type PURGE-IDENTITY-ACCEPTANCE to delete only this Compose project's volumes: " confirmation
  [[ "$confirmation" == "PURGE-IDENTITY-ACCEPTANCE" ]] || { echo "Purge cancelled." >&2; exit 1; }
  (cd "$acceptance_dir" && docker compose -p dachuan-identity-acceptance --env-file "$env_file" down --volumes --remove-orphans)
  echo "Isolated stack and volumes removed."
else
  (cd "$acceptance_dir" && docker compose -p dachuan-identity-acceptance --env-file "$env_file" down --remove-orphans)
  echo "Isolated stack stopped; volumes retained for recovery."
fi
