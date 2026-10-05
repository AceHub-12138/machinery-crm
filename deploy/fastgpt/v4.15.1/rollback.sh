#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?usage: rollback.sh /path/to/FastGPT}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
patch_file="${script_dir}/0001-dachuan-trusted-mcp-identity.patch"
git -C "${source_dir}" apply -R --check "${patch_file}"
git -C "${source_dir}" apply -R "${patch_file}"
echo "FastGPT trusted identity patch rolled back."
