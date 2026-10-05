#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$acceptance_dir/../.." && pwd)"
env_file="$acceptance_dir/.env.identity-acceptance"
command -v docker >/dev/null || { echo "Docker is required for isolated acceptance." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 20 or newer is required for isolated acceptance." >&2; exit 1; }
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20) process.exit(1)' || {
  echo "Node.js 20 or newer is required for isolated acceptance." >&2
  exit 1
}
docker compose version >/dev/null
if [[ ! -f "$env_file" ]]; then
  node "$acceptance_dir/prepare-env.mjs" "$acceptance_dir/.env.identity-acceptance.example" "$env_file"
fi
node "$acceptance_dir/validate-env.mjs" "$env_file"
if [[ "${IDENTITY_ACCEPTANCE_USE_PREBUILT_IMAGES:-0}" == "1" ]]; then
  image_dir="$repo_root/images"
  external_image_ids="$repo_root/EXTERNAL_IMAGE_IDS.tsv"
  checksum_manifest="$repo_root/SHA256SUMS"
  command -v sha256sum >/dev/null || { echo "sha256sum is required for prebuilt artifact verification." >&2; exit 1; }
  test -s "$checksum_manifest" || { echo "Missing artifact SHA256SUMS manifest." >&2; exit 1; }
  (
    cd "$repo_root"
    sha256sum -c SHA256SUMS
  )
  test -s "$external_image_ids" || { echo "Missing external image identity manifest." >&2; exit 1; }
  [[ "$(head -n 1 "$external_image_ids")" == $'image\tlinuxAmd64ManifestDigest\tociIndexDigest\tconfigDigest\tarchive' ]] || {
    echo "External image identity manifest header is invalid." >&2
    exit 1
  }
  while IFS=$'\t' read -r image platform_digest index_digest config_digest archive; do
    [[ "$image" == "image" ]] && continue
    test -s "$image_dir/$archive" || { echo "Missing prebuilt external image archive: $archive" >&2; exit 1; }
    [[ "$platform_digest" == sha256:* && "$index_digest" == sha256:* && "$config_digest" == sha256:* ]] || {
      echo "External image digest lock is malformed: $image" >&2
      exit 1
    }
    node "$acceptance_dir/validate-prebuilt-image-archive.mjs" "$image_dir/$archive" "$image" "$config_digest"
  done < "$external_image_ids"
  fastgpt_image="$(sed -n 's/^FASTGPT_IMAGE=//p' "$env_file")"
  crm_image="$(sed -n 's/^CRM_IMAGE=//p' "$env_file")"
  custom_images=("$fastgpt_image" "$crm_image" dachuanpro-identity-acceptance-runner:1.0.0)
  custom_archives=(
    "$image_dir/dachuan-fastgpt-v4.15.1-identity-acceptance.1.tar.gz"
    "$image_dir/dachuanpro-crm-erp-mcp-1.2.0-identity-acceptance.1.tar.gz"
    "$image_dir/dachuanpro-identity-acceptance-runner-1.0.0.tar.gz"
  )
  for index in "${!custom_archives[@]}"; do
    archive="${custom_archives[$index]}"
    image="${custom_images[$index]}"
    test -s "$archive" || { echo "Missing prebuilt image archive: $archive" >&2; exit 1; }
    gzip -dc "$archive" | docker load
    docker image inspect "$image" >/dev/null
    [[ "$(docker image inspect "$image" --format '{{.Os}}')" == "linux" && "$(docker image inspect "$image" --format '{{.Architecture}}')" == "amd64" ]] || {
      echo "Loaded image platform is not linux/amd64: $image" >&2
      exit 1
    }
  done
  while IFS=$'\t' read -r image platform_digest index_digest config_digest archive; do
    [[ "$image" == "image" ]] && continue
    gzip -dc "$image_dir/$archive" | docker load
    docker image inspect "$image" >/dev/null
    [[ "$(docker image inspect "$image" --format '{{.Os}}')" == "linux" && "$(docker image inspect "$image" --format '{{.Architecture}}')" == "amd64" ]] || {
      echo "Loaded image platform is not linux/amd64: $image" >&2
      exit 1
    }
  done < "$external_image_ids"
  echo "IDENTITY_ACCEPTANCE_PREBUILT_IMAGES=LOADED"
else
  "$acceptance_dir/build-fastgpt.sh" "${1:-}"
  docker build --progress=plain -f "$acceptance_dir/Dockerfile.mcp" -t "dachuanpro-crm-erp-mcp:1.2.0-identity-acceptance.1" "$repo_root"
  docker build --progress=plain -f "$acceptance_dir/Dockerfile.acceptance" -t "dachuanpro-identity-acceptance-runner:1.0.0" "$repo_root"
fi
pushd "$acceptance_dir" >/dev/null
compose=(docker compose -p dachuan-identity-acceptance --env-file "$env_file")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 300 mysql identity-redis
"${compose[@]}" create --force-recreate db-init

expected_data_network="dachuan-identity-acceptance_identity-data"
db_init_container="$("${compose[@]}" ps -q --all db-init)"
mysql_container="$("${compose[@]}" ps -q mysql)"
[[ -n "$db_init_container" && -n "$mysql_container" ]] || { echo "Isolated database containers are missing." >&2; exit 1; }
network_internal="$(docker network inspect "$expected_data_network" --format '{{.Internal}}')"
db_init_networks="$(docker inspect "$db_init_container" --format '{{range $key, $value := .NetworkSettings.Networks}}{{println $key}}{{end}}' | sed '/^$/d')"
mysql_networks="$(docker inspect "$mysql_container" --format '{{range $key, $value := .NetworkSettings.Networks}}{{println $key}}{{end}}' | sed '/^$/d')"
db_init_ports="$(docker inspect "$db_init_container" --format '{{json .HostConfig.PortBindings}}')"
mysql_ports="$(docker inspect "$mysql_container" --format '{{json .HostConfig.PortBindings}}')"
[[ "$network_internal" == "true" && "$db_init_networks" == "$expected_data_network" && "$mysql_networks" == "$expected_data_network" && ( "$db_init_ports" == "null" || "$db_init_ports" == "{}" ) && ( "$mysql_ports" == "null" || "$mysql_ports" == "{}" ) ]] || {
  echo "Refusing migration: database containers are not isolated on the expected internal Docker network." >&2
  exit 1
}
echo "IDENTITY_ACCEPTANCE_DATABASE_NETWORK=VERIFIED"

"${compose[@]}" start db-init
db_init_exit_code="$(docker wait "$db_init_container")"
[[ "$db_init_exit_code" == "0" ]] || { echo "Isolated migration/seed failed with exit code $db_init_exit_code." >&2; exit 1; }
db_init_logs="$(docker logs "$db_init_container" 2>&1)" || {
  echo "Unable to read isolated migration logs." >&2
  exit 1
}
node "$acceptance_dir/verify-db-init-privilege-log.mjs" <<<"$db_init_logs" || {
  echo "Isolated MCP database privilege gates failed." >&2
  exit 1
}
echo "IDENTITY_ACCEPTANCE_DB_INIT_EXIT_CODE=0"
echo "MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS"
echo "MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS"

"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 900
"${compose[@]}" ps

if [[ "${IDENTITY_ACCEPTANCE_AUTO_PROVISION_FASTGPT_KEY:-0}" == "1" ]]; then
  node "$acceptance_dir/provision-fastgpt-key.mjs" "$env_file" "http://127.0.0.1:18081"
  "${compose[@]}" up -d --no-build --pull never --no-deps --force-recreate crm
  "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 300
  "${compose[@]}" ps
  echo "IDENTITY_ACCEPTANCE_FASTGPT_KEY=AUTO_PROVISIONED"
fi
popd >/dev/null
echo "CRM=http://127.0.0.1:18080"
echo "FastGPT=http://127.0.0.1:18081"
echo "MCP=http://127.0.0.1:18080/api/mcp"
if [[ "${IDENTITY_ACCEPTANCE_AUTO_PROVISION_FASTGPT_KEY:-0}" != "1" ]]; then
  echo "Create the isolated FastGPT Agent/API key, update AGENT_GATEWAY_FASTGPT_API_KEY, recreate crm, then run accept.sh."
fi
