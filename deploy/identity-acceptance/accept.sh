#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$acceptance_dir/.env.identity-acceptance"
expected_tool_mode="${EXPECTED_MCP_TOOL_MODE:-IDENTITY_POC}"
[[ "$expected_tool_mode" == "IDENTITY_POC" || "$expected_tool_mode" == "FULL_READ_ONLY" ]] || { echo "EXPECTED_MCP_TOOL_MODE must be IDENTITY_POC or FULL_READ_ONLY." >&2; exit 1; }
test -f "$env_file" || { echo "Missing $env_file; run start.sh first." >&2; exit 1; }
grep -qx "MCP_TOOL_MODE=$expected_tool_mode" "$env_file" || { echo "Acceptance requires MCP_TOOL_MODE=$expected_tool_mode." >&2; exit 1; }
! grep -q '^AGENT_GATEWAY_FASTGPT_API_KEY=REPLACE_' "$env_file" || { echo "Configure the isolated FastGPT Agent/API key first." >&2; exit 1; }
node "$acceptance_dir/validate-env.mjs" "$env_file"
fastgpt_image="$(sed -n 's/^FASTGPT_IMAGE=//p' "$env_file")"
expected_revision="$(sed -n 's/^FASTGPT_SOURCE_COMMIT=//p' "$env_file")"
image_revision="$(docker image inspect "$fastgpt_image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
image_tests="$(docker image inspect "$fastgpt_image" --format '{{ index .Config.Labels "dachuan.identity.tests" }}')"
image_acceptance="$(docker image inspect "$fastgpt_image" --format '{{ index .Config.Labels "dachuan.identity.acceptance" }}')"
image_id="$(docker image inspect "$fastgpt_image" --format '{{ .Id }}')"
crm_image="$(sed -n 's/^CRM_IMAGE=//p' "$env_file")"
crm_image_id="$(docker image inspect "$crm_image" --format '{{ .Id }}')"
runner_image_id="$(docker image inspect dachuanpro-identity-acceptance-runner:1.0.0 --format '{{ .Id }}')"
fastgpt_container="$(cd "$acceptance_dir" && docker compose -p dachuan-identity-acceptance --env-file "$env_file" ps -q fastgpt)"
[[ -n "$fastgpt_container" ]] || { echo "The isolated FastGPT container is not running." >&2; exit 1; }
running_image_id="$(docker inspect "$fastgpt_container" --format '{{ .Image }}')"
[[ "$image_revision" == "$expected_revision" && "$image_tests" == "mcp-context-lead-service-pass" && "$image_acceptance" == "true" && "$image_id" == sha256:* && "$running_image_id" == "$image_id" ]] || { echo "FastGPT image gate failed." >&2; exit 1; }
output_dir="$acceptance_dir/acceptance-output"
mkdir -p "$output_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
runner_output="$output_dir/$stamp-runner.log"
service_logs="$output_dir/$stamp-services.log"
evidence_name="$stamp-result.json"
evidence_file="$output_dir/$evidence_name"
(cd "$acceptance_dir" && docker compose -p dachuan-identity-acceptance --env-file "$env_file" --profile acceptance run --rm --no-deps \
  -e "ACCEPTANCE_EVIDENCE_FILE=/evidence/$evidence_name" \
  -e "ACCEPTANCE_FASTGPT_IMAGE_ID=$image_id" \
  -e "ACCEPTANCE_CRM_IMAGE_ID=$crm_image_id" \
  -e "ACCEPTANCE_RUNNER_IMAGE_ID=$runner_image_id" \
  acceptance-runner) 2>&1 | tee "$runner_output"
host_uid="$(id -u)"
host_gid="$(id -g)"
(cd "$acceptance_dir" && docker compose -p dachuan-identity-acceptance --env-file "$env_file" --profile acceptance run --rm --no-deps \
  --entrypoint sh acceptance-runner -c \
  "chown $host_uid:$host_gid /evidence/$evidence_name && chmod 0600 /evidence/$evidence_name")
node - "$evidence_file" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const stat = fs.statSync(path);
if (!stat.isFile() || stat.size === 0) throw new Error('Identity acceptance evidence is missing or empty.');
const evidence = JSON.parse(fs.readFileSync(path, 'utf8'));
if (evidence.overallStatus !== 'PASS') throw new Error('Identity acceptance evidence overallStatus is not PASS.');
if (evidence.sensitiveScanStatus !== 'PASS') throw new Error('Runner sensitive information scan is not PASS.');
NODE
(cd "$acceptance_dir" && docker compose -p dachuan-identity-acceptance --env-file "$env_file" logs --no-color crm fastgpt nginx identity-redis mysql fastgpt-mongo fastgpt-redis fastgpt-pg fastgpt-minio fastgpt-plugin fastgpt-code-sandbox fastgpt-aiproxy fastgpt-aiproxy-pg) > "$service_logs"
node - "$env_file" "$runner_output" "$service_logs" "$evidence_file" <<'NODE'
const fs = require('fs');
const path = require('path');
const [envPath, runnerLog, serviceLog, evidencePath] = process.argv.slice(2);
const settings = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(x => { const i=x.indexOf('='); return [x.slice(0,i),x.slice(i+1)]; }));
const keyPart = JSON.parse(settings.AGENT_AUTH_KEYS_JSON)[0].privateJwk.d;
const leadPrivatePart = JSON.parse(fs.readFileSync(path.join(path.dirname(envPath), '.lead-service-private-jwk'), 'utf8')).d;
const secrets = ['MCP_SERVICE_KEY','MCP_LEAD_SERVICE_KEY','MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD','MCP_QUERY_DB_PASSWORD','MCP_AUDIT_DB_PASSWORD','MCP_COMMAND_DB_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','CRM_AGENT_ASSERTION_SECRET','AGENT_GATEWAY_FASTGPT_API_KEY','LEAD_E2E_FASTGPT_API_KEY','ACCEPTANCE_USER_PASSWORD','FASTGPT_ROOT_PASSWORD','FASTGPT_ROOT_KEY','FASTGPT_TOKEN_KEY','FASTGPT_FILE_TOKEN_KEY','FASTGPT_AES_KEY','FASTGPT_INVOKE_TOKEN_SECRET','FASTGPT_MONGO_PASSWORD','FASTGPT_REDIS_PASSWORD','FASTGPT_PG_PASSWORD','FASTGPT_PLUGIN_TOKEN','FASTGPT_SANDBOX_TOKEN','FASTGPT_AIPROXY_PG_PASSWORD','FASTGPT_AIPROXY_API_TOKEN'].map(k => settings[k]).concat(keyPart, leadPrivatePart).filter(x => x && x.length >= 8 && !x.startsWith('REPLACE_'));
const text = [runnerLog, serviceLog].map(x => fs.readFileSync(x, 'utf8')).join('\n');
if (secrets.some(x => text.includes(x))) throw new Error('Sensitive information scan failed.');
if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text) || /x-dachuan-(?:user|service)-assertion\s*[:=]\s*\S+/i.test(text)) throw new Error('Dynamic assertion found in logs.');
if (!text.includes('IDENTITY_ACCEPTANCE_RESULT=PASS')) throw new Error('Acceptance PASS marker missing.');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
evidence.finalSensitiveLogScanStatus = 'PASS';
evidence.finalizedAt = new Date().toISOString();
const temporary = `${evidencePath}.tmp`;
const descriptor = fs.openSync(temporary, 'w', 0o600);
try {
  fs.writeSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
fs.renameSync(temporary, evidencePath);
NODE
echo "IDENTITY_ISOLATED_ACCEPTANCE=PASS"
echo "FASTGPT_IMAGE_ID=$image_id"
echo "CRM_IMAGE_ID=$crm_image_id"
echo "RUNNER_IMAGE_ID=$runner_image_id"
echo "EVIDENCE_FILE=$evidence_file"
echo "Evidence directory: $output_dir"
