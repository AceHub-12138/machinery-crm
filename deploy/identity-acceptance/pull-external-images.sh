#!/usr/bin/env bash
set -euo pipefail

acceptance_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lock_file="$acceptance_dir/external-images.lock.tsv"
test -s "$lock_file" || { echo "Missing external image lock file." >&2; exit 1; }

while IFS=$'\t' read -r image platform_digest index_digest archive; do
  [[ -z "$image" || "$image" == \#* ]] && continue
  [[ "$platform_digest" == sha256:* && "$index_digest" == sha256:* && -n "$archive" ]] || {
    echo "Invalid external image lock entry for $image." >&2
    exit 1
  }
  docker pull --platform linux/amd64 "$image@$platform_digest"
  docker tag "$image@$platform_digest" "$image"
  docker image inspect "$image" >/dev/null
  printf 'EXTERNAL_IMAGE_LOCK=PASS image=%s platform=linux/amd64 digest=%s\n' "$image" "$platform_digest"
done < "$lock_file"
