#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$acceptance_dir/../.." && pwd)"
env_file="$acceptance_dir/.env.identity-acceptance"
artifact_dir="${1:-$repo_root/dist/full-readonly-linux-acceptance}"
test -f "$env_file" || { echo "Missing isolated environment file." >&2; exit 1; }
node "$acceptance_dir/validate-env.mjs" "$env_file"
grep -qx 'IDENTITY_ACCEPTANCE_ENV=isolated' "$env_file"
grep -qx 'MCP_TOOL_MODE=FULL_READ_ONLY' "$env_file"

evidence_file="$(find "$acceptance_dir/acceptance-output" -maxdepth 1 -type f -name '*-result.json' -printf '%T@ %p\n' | sort -nr | awk 'NR==1 {$1=""; sub(/^ /, ""); print; exit}')"
[[ -n "$evidence_file" ]] || { echo "Acceptance result JSON was not found." >&2; exit 1; }
[[ -s "$evidence_file" ]] || { echo "Acceptance result JSON is empty." >&2; exit 1; }

node - "$evidence_file" <<'NODE'
const fs = require('node:fs');
const evidence = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (evidence.overallStatus !== 'PASS') throw new Error('overallStatus is not PASS');
if (evidence.sensitiveScanStatus !== 'PASS') throw new Error('runner sensitive scan is not PASS');
if (evidence.finalSensitiveLogScanStatus !== 'PASS') throw new Error('final log sensitive scan is not PASS');
if (evidence.checks?.length !== 16) throw new Error('acceptance check count is not 16');
if (evidence.requestIdSummary?.count !== evidence.requestIdSummary?.uniqueCount) throw new Error('requestId reuse detected');
NODE

crm_image="$(sed -n 's/^CRM_IMAGE=//p' "$env_file")"
fastgpt_image="$(sed -n 's/^FASTGPT_IMAGE=//p' "$env_file")"
runner_image="dachuanpro-identity-acceptance-runner:1.0.0"
for image in "$fastgpt_image" "$crm_image" "$runner_image"; do
  [[ -n "$image" && "$image" != *:latest ]] || { echo "Unpinned image tag: $image" >&2; exit 1; }
  docker image inspect "$image" >/dev/null
done

[[ "$artifact_dir" != "/" && ! -e "$artifact_dir" ]] || { echo "Artifact target must be a new non-root path: $artifact_dir" >&2; exit 1; }
mkdir -p "$artifact_dir/images" "$artifact_dir/deploy/identity-acceptance" "$artifact_dir/deploy/fastgpt/v4.15.1/workflows"

bash "$acceptance_dir/pull-external-images.sh"

docker save "$fastgpt_image" | gzip -9 > "$artifact_dir/images/dachuan-fastgpt-v4.15.1-identity-acceptance.1.tar.gz"
docker save "$crm_image" | gzip -9 > "$artifact_dir/images/dachuanpro-crm-erp-mcp-1.2.0-identity-acceptance.1.tar.gz"
docker save "$runner_image" | gzip -9 > "$artifact_dir/images/dachuanpro-identity-acceptance-runner-1.0.0.tar.gz"

{
  printf 'image\tlinuxAmd64ManifestDigest\tociIndexDigest\tconfigDigest\tarchive\n'
  while IFS=$'\t' read -r image platform_digest index_digest archive; do
    [[ -z "$image" || "$image" == \#* ]] && continue
    docker save "$image" | gzip -9 > "$artifact_dir/images/$archive"
    config_digest="$(node "$acceptance_dir/validate-prebuilt-image-archive.mjs" --config-digest "$artifact_dir/images/$archive" "$image")"
    printf '%s\t%s\t%s\t%s\t%s\n' "$image" "$platform_digest" "$index_digest" "$config_digest" "$archive"
  done < "$acceptance_dir/external-images.lock.tsv"
} > "$artifact_dir/EXTERNAL_IMAGE_IDS.tsv"

for file in docker-compose.yml start.sh accept.sh accept-lead-e2e.sh rollback.sh build-fastgpt.sh pull-external-images.sh validate-prebuilt-image-archive.mjs verify-db-init-privilege-log.mjs external-images.lock.tsv generate-linux-report.mjs provision-fastgpt-key.mjs provision-lead-e2e.mjs lead-e2e-workflow.mjs prepare-env.mjs validate-env.mjs .env.identity-acceptance.example Dockerfile.fastgpt Dockerfile.mcp Dockerfile.acceptance nginx.conf; do
  cp -a "$acceptance_dir/$file" "$artifact_dir/deploy/identity-acceptance/$file"
done
cp -a "$repo_root/deploy/fastgpt/v4.15.1/workflows/lead-score-agent-v1.json" "$artifact_dir/deploy/fastgpt/v4.15.1/workflows/lead-score-agent-v1.json"
cp -a "$repo_root/deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json" "$artifact_dir/deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json"
chmod +x "$artifact_dir/deploy/identity-acceptance/"*.sh

write_sha256sums() {
  (
    cd "$artifact_dir"
    find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  )
}

# The prebuilt cold-start check validates the same artifact files that will be published.
# Regenerate after its evidence is added so the final manifest covers every deliverable file.
write_sha256sums

prebuilt_revalidated="NO"
if [[ "${IDENTITY_ACCEPTANCE_VERIFY_PREBUILT:-0}" == "1" ]]; then
  artifact_acceptance_dir="$artifact_dir/deploy/identity-acceptance"
  mkdir -p "$artifact_acceptance_dir/acceptance-output"
  IDENTITY_ACCEPTANCE_TOOL_MODE=FULL_READ_ONLY \
    IDENTITY_ACCEPTANCE_USE_PREBUILT_IMAGES=1 \
    IDENTITY_ACCEPTANCE_AUTO_PROVISION_FASTGPT_KEY=1 \
    "$artifact_acceptance_dir/start.sh"
  EXPECTED_MCP_TOOL_MODE=FULL_READ_ONLY "$artifact_acceptance_dir/accept.sh"
  printf '%s\n' PURGE-IDENTITY-ACCEPTANCE | "$artifact_acceptance_dir/rollback.sh" --purge-isolated-data
  compose_output="$(docker compose -p dachuan-identity-acceptance --env-file "$artifact_acceptance_dir/.env.identity-acceptance" -f "$artifact_acceptance_dir/docker-compose.yml" ps -q)"
  [[ -z "$compose_output" ]] || { echo "Prebuilt artifact rollback left containers running." >&2; exit 1; }
  volume_output="$(docker volume ls -q --filter label=com.docker.compose.project=dachuan-identity-acceptance)"
  [[ -z "$volume_output" ]] || { echo "Prebuilt artifact rollback left isolated volumes behind." >&2; exit 1; }
  prebuilt_evidence="$(find "$artifact_acceptance_dir/acceptance-output" -maxdepth 1 -type f -name '*-result.json' -printf '%T@ %p\n' | sort -nr | awk 'NR==1 {$1=""; sub(/^ /, ""); print; exit}')"
  [[ -n "$prebuilt_evidence" ]] || { echo "Prebuilt acceptance result JSON was not found." >&2; exit 1; }
  [[ -s "$prebuilt_evidence" ]] || { echo "Prebuilt acceptance result JSON is empty." >&2; exit 1; }
  cp -a "$prebuilt_evidence" "$artifact_dir/acceptance-result.json"
  rm -f "$artifact_acceptance_dir/.env.identity-acceptance"
  rm -f "$artifact_acceptance_dir/.lead-service-private-jwk"
  rm -rf "$artifact_acceptance_dir/acceptance-output"
  evidence_file="$artifact_dir/acceptance-result.json"
  prebuilt_revalidated="PASS"
else
  cp -a "$evidence_file" "$artifact_dir/acceptance-result.json"
  evidence_file="$artifact_dir/acceptance-result.json"
fi

[[ ! -e "$artifact_dir/deploy/identity-acceptance/.env.identity-acceptance" ]] || { echo "Artifact must not contain runtime env." >&2; exit 1; }
[[ ! -e "$artifact_dir/deploy/identity-acceptance/.lead-service-private-jwk" ]] || { echo "Artifact must not contain the Lead SERVICE private JWK." >&2; exit 1; }

{
  printf 'name\ttag\timageId\tsizeBytes\trepoDigests\n'
  for spec in "fastgpt|$fastgpt_image" "crm-mcp|$crm_image" "acceptance-runner|$runner_image"; do
    name="${spec%%|*}"
    image="${spec#*|}"
    tag="$(docker image inspect "$image" --format '{{index .RepoTags 0}}')"
    image_id="$(docker image inspect "$image" --format '{{.Id}}')"
    image_size="$(docker image inspect "$image" --format '{{.Size}}')"
    repo_digests="$(docker image inspect "$image" --format '{{if .RepoDigests}}{{join .RepoDigests ","}}{{end}}')"
    printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$tag" "$image_id" "$image_size" "$repo_digests"
  done
} > "$artifact_dir/IMAGE_IDS.tsv"

ARTIFACT_DIR="$artifact_dir" EVIDENCE_FILE="$evidence_file" PREBUILT_REVALIDATED="$prebuilt_revalidated" GIT_SHA="$(git -C "$repo_root" rev-parse HEAD)" GIT_BRANCH="${GITHUB_REF_NAME:-$(git -C "$repo_root" branch --show-current)}" node "$acceptance_dir/generate-linux-report.mjs" "$artifact_dir" "$evidence_file"
: <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const artifactDir = process.env.ARTIFACT_DIR;
const evidence = JSON.parse(fs.readFileSync(process.env.EVIDENCE_FILE, 'utf8'));
const imageRows = fs.readFileSync(path.join(artifactDir, 'IMAGE_IDS.tsv'), 'utf8').trim().split('\n').slice(1);
const imageTable = imageRows.map((row) => {
  const [name, tag, id, size, digests] = row.split('\t');
  return `| ${name} | \`${tag}\` | \`${id}\` | ${size} | ${digests ? `\`${digests}\`` : '本地构建镜像，无 RepoDigest'} |`;
}).join('\n');
const externalRows = fs.readFileSync(path.join(artifactDir, 'EXTERNAL_IMAGE_IDS.tsv'), 'utf8').trim().split('\n').slice(1);
const externalImageTable = externalRows.map((row) => {
  const [image, platformDigest, indexDigest, configDigest, archive] = row.split('\t');
  return `| \`${image}\` | \`${platformDigest}\` | \`${indexDigest}\` | \`${configDigest}\` | \`${archive}\` |`;
}).join('\n');
const checks = evidence.checks.map((check) => `- PASS：${check}`).join('\n');
const report = `# FULL_READ_ONLY Linux 隔离验收报告

- 分支：\`${process.env.GIT_BRANCH}\`
- Commit：\`${process.env.GIT_SHA}\`
- GitHub Actions Run ID：\`${process.env.GITHUB_RUN_ID || 'local'}\`
- Runner：\`${process.env.RUNNER_NAME || 'Linux'}\`
- 操作系统：\`${process.env.RUNNER_OS || 'Linux'}\`
- 模式：\`FULL_READ_ONLY\`
- 结论：PASS
- 未连接生产数据库、生产 Redis、正式 FastGPT 或正式域名

## 验收证据

- overallStatus：\`${evidence.overallStatus}\`
- 检查数：\`${evidence.checks.length}\`
- requestId：\`${evidence.requestIdSummary.count}\`，唯一值 \`${evidence.requestIdSummary.uniqueCount}\`
- Runner 敏感扫描：\`${evidence.sensitiveScanStatus}\`
- 最终日志敏感扫描：\`${evidence.finalSensitiveLogScanStatus}\`
- 空卷、无运行时 env 的十二镜像预构建成品冷启动复验：\`${process.env.PREBUILT_REVALIDATED}\`

${checks}

## 镜像

| 名称 | 固定标签 | Image ID | 大小（字节） | RepoDigest |
| --- | --- | --- | ---: | --- |
${imageTable}

## 内置外部运行时镜像（linux/amd64）

| 镜像 | 平台 manifest digest | OCI index digest | Config Digest | Artifact 文件 |
| --- | --- | --- | --- | --- |
${externalImageTable}

## 准入结论

十二张运行时镜像均内置于成品。经 `SHA256SUMS` 校验后，预构建模式只执行本地 `docker load` 和 `docker compose up --pull never`，因此隔离验收启动不依赖外部镜像仓库。生产部署不在本次工作流范围内。
`;
fs.writeFileSync(path.join(artifactDir, 'LINUX_ACCEPTANCE_REPORT.md'), report);
NODE

cat > "$artifact_dir/SERVER_ISOLATED_TEST.md" <<'EOF'
# 服务器隔离测试

本成品只用于隔离测试，不得连接生产数据库、生产 Redis、正式 FastGPT 或正式域名。

前置条件：Linux x86_64、Docker Engine、Docker Compose v2、Node.js 20 或更新版本及 gzip。Artifact 内置三项项目自建镜像和九项外部运行时镜像；先校验 `SHA256SUMS`，预构建模式会加载全部十二张镜像，并以 `docker compose up --pull never` 启动。因此服务器隔离验收不需要访问 Docker Hub、GHCR 或其他镜像仓库。

```bash
export IDENTITY_ACCEPTANCE_TOOL_MODE=FULL_READ_ONLY
export IDENTITY_ACCEPTANCE_USE_PREBUILT_IMAGES=1
export IDENTITY_ACCEPTANCE_AUTO_PROVISION_FASTGPT_KEY=1
./deploy/identity-acceptance/start.sh
EXPECTED_MCP_TOOL_MODE=FULL_READ_ONLY ./deploy/identity-acceptance/accept.sh
./deploy/identity-acceptance/rollback.sh
```

`start.sh` 会在加载前校验 `SHA256SUMS`、外部镜像 tar 内 `manifest.json` 的 RepoTags、Config Digest 与 linux/amd64 平台；加载后复验标签和 linux/amd64。它动态生成仅用于隔离环境的凭据，并拒绝使用非隔离目标。`rollback.sh` 默认停止固定 Compose 项目并保留隔离卷；生产部署不在本成品范围内。
EOF

if grep -RInE '(^|[[:space:]])[^#[:space:]]+:latest([[:space:]]|$)' "$artifact_dir/deploy/identity-acceptance"; then
  echo "Artifact contains a latest image tag." >&2
  exit 1
fi

write_sha256sums
(
  cd "$artifact_dir"
  sha256sum -c SHA256SUMS
)

echo "FULL_READ_ONLY_LINUX_ARTIFACT=$artifact_dir"
