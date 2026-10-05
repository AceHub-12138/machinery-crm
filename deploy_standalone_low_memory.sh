#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/machinery-crm-v108-upload-security-step1}"
ENV_SOURCE="${ENV_SOURCE:-/opt/machinery-crm-v108-release/.env}"
PM2_APP="${PM2_APP:-machinery-crm}"
UPLOAD_DIR="${UPLOAD_DIR:-/opt/machinery-crm-uploads}"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  [[ -f "$ENV_SOURCE" ]] || {
    echo "Missing .env. Set ENV_SOURCE to the old production .env path." >&2
    exit 1
  }
  cp "$ENV_SOURCE" .env
fi

mkdir -p "$UPLOAD_DIR"
grep -q '^UPLOAD_DIR=' .env || printf '\nUPLOAD_DIR=%s\n' "$UPLOAD_DIR" >> .env

if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  pm2 start start-standalone.cjs --name "$PM2_APP"
fi

pm2 save
