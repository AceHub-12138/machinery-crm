#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?usage: apply.sh /path/to/FastGPT}"
expected_commit="a0aec83f2ae444f5783416d17d0d9d12b7c1dc39"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
patch_file="${script_dir}/0001-dachuan-trusted-mcp-identity.patch"
actual_commit="$(git -C "${source_dir}" rev-parse HEAD)"
if [[ "${actual_commit}" != "${expected_commit}" ]]; then
  echo "FastGPT source commit must be ${expected_commit}, got ${actual_commit}" >&2
  exit 1
fi
git -C "${source_dir}" apply --check "${patch_file}"
git -C "${source_dir}" apply "${patch_file}"
echo "FastGPT v4.15.1 trusted identity and Lead SERVICE assertion patch applied."
