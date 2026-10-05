#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$acceptance_dir/../.." && pwd)"
env_file="$acceptance_dir/.env.identity-acceptance"
source_dir="${1:-$acceptance_dir/.build/fastgpt}"
test -f "$env_file" || { echo "Missing $env_file; run start.sh first." >&2; exit 1; }
expected_commit="$(sed -n 's/^FASTGPT_SOURCE_COMMIT=//p' "$env_file")"
image="$(sed -n 's/^FASTGPT_IMAGE=//p' "$env_file")"

if [[ ! -d "$source_dir/.git" ]]; then
  mkdir -p "$(dirname "$source_dir")"
  git clone https://github.com/labring/FastGPT.git "$source_dir"
  git -C "$source_dir" checkout --detach "$expected_commit"
fi
current_commit="$(git -C "$source_dir" rev-parse HEAD)"
[[ "$current_commit" == "$expected_commit" ]] || { echo "FastGPT source must be exactly $expected_commit; found $current_commit" >&2; exit 1; }

patch_file="$repo_root/deploy/fastgpt/v4.15.1/0001-dachuan-trusted-mcp-identity.patch"
if ! git -C "$source_dir" apply --check -R "$patch_file" 2>/dev/null; then
  "$repo_root/deploy/fastgpt/v4.15.1/apply.sh" "$source_dir"
fi
dockerfile="$acceptance_dir/Dockerfile.fastgpt"
test -f "$dockerfile" || { echo "Missing $dockerfile" >&2; exit 1; }

# All pnpm calls, lifecycle scripts and identity patch tests run inside the
# pinned Docker toolchain. Never resolve pnpm from the Linux host PATH here.
docker build \
  --progress=plain \
  --label "org.opencontainers.image.revision=$expected_commit" \
  --label "dachuan.identity.acceptance=true" \
  --label "dachuan.identity.tests=mcp-context-lead-service-pass" \
  --label "dachuan.pnpm.version=10.33.4" \
  -f "$dockerfile" -t "$image" "$source_dir"
docker run --rm --entrypoint node "$image" -e "const {createCanvas}=require('canvas'); const c=createCanvas(10,10); console.log(c.width,c.height)"
docker run --rm --entrypoint sh "$image" -c '
set -eu
node_file="$(find /app/node_modules/canvas -name canvas.node -type f -print -quit)"
test -n "$node_file"
echo "CANVAS_NODE=$node_file"
ldd_output="$(ldd "$node_file" 2>&1 || true)"
printf "%s\n" "$ldd_output" | sed -n "/=>/p"
if printf "%s\n" "$ldd_output" | grep -E "=> not found|Error loading shared library .*: No such file or directory"; then
  echo "CANVAS_LDD=FAIL" >&2
  exit 1
fi
echo "CANVAS_LDD=PASS_NO_SHARED_LIBRARY_NOT_FOUND"
for tool in python3 make g++; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "RUNTIME_TOOLCHAIN_GATE=FAIL tool=$tool" >&2
    exit 1
  fi
done
echo "RUNTIME_TOOLCHAIN_GATE=PASS"
'
echo "FASTGPT_IMAGE_READY=$image"
