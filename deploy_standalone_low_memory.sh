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

[[ -f ecosystem.config.cjs ]] || { echo "Missing ecosystem.config.cjs" >&2; exit 1; }
PM2_APP="$PM2_APP" HOSTNAME=127.0.0.1 pm2 startOrRestart ecosystem.config.cjs --update-env

pm2 save
