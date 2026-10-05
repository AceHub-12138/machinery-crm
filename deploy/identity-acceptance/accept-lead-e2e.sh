#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$acceptance_dir/.env.identity-acceptance"
test -f "$env_file" || { echo "Run start.sh before Lead E2E acceptance." >&2; exit 1; }
node "$acceptance_dir/validate-env.mjs" "$env_file"

pushd "$acceptance_dir" >/dev/null
compose=(docker compose -p dachuan-identity-acceptance --env-file "$env_file" --profile lead-e2e)
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 300 lead-mcp lead-llm-mock
node "$acceptance_dir/provision-lead-e2e.mjs" "$env_file" "http://127.0.0.1:18081"
"${compose[@]}" up -d --no-build --pull never --no-deps --force-recreate fastgpt
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 300 fastgpt lead-mcp lead-llm-mock
"${compose[@]}" run --rm --no-deps lead-e2e-runner
popd >/dev/null
echo "LEAD_E2E_ISOLATED_STACK=PASS"
