# Low-memory standalone deployment

This package is prebuilt. Do not run `pnpm build` on the server.

## Requirements

- Linux x64 glibc server
- Node.js 20 or newer
- PM2
- Existing production `.env`
- Persistent uploads directory, normally `/opt/machinery-crm-uploads`

## Deploy

```bash
APP_DIR=/opt/machinery-crm-v108-release
PACKAGE=/opt/machinery-crm-v108-step1-prebuilt-standalone-linux-x64-YYYY-MM-DD-HHMM.tar.gz
BACKUP_DIR=/opt/crm-step1-backup-$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"
cp "$APP_DIR/.env" "$BACKUP_DIR/.env"
mv "$APP_DIR/.next" "$BACKUP_DIR/.next"

# The archive contains one top-level folder, so strip it while extracting
# directly into the existing PM2 working directory.
tar -xzf "$PACKAGE" -C "$APP_DIR" --strip-components=1
cp "$BACKUP_DIR/.env" "$APP_DIR/.env"

cd "$APP_DIR"
grep '^UPLOAD_DIR=' .env || echo 'UPLOAD_DIR=/opt/machinery-crm-uploads' >> .env
pm2 restart machinery-crm --update-env
pm2 save
```

For a new PM2 application or a new directory:

```bash
cd /opt/machinery-crm-v108-upload-security-step1
pm2 start start-standalone.cjs --name machinery-crm
pm2 save
```

The standalone package already contains traced runtime dependencies and Prisma
engines for common Debian/Ubuntu and RHEL-compatible Linux x64 systems. Do not
run `pnpm install`, `pnpm exec prisma generate`, or `pnpm build` for the normal
standalone deployment.

## Fallback deployment

If standalone cannot start because the server platform is not Linux x64 glibc,
use the included source and prebuilt `.next` output:

```bash
pnpm install --prod --frozen-lockfile
pnpm exec prisma generate
echo 'START_MODE=next' >> .env
pm2 restart machinery-crm --update-env
```

Do not run `pnpm build`.

## Security requirement

Remove or disable any Nginx `location /uploads` static-file rule. Nginx static
serving bypasses Next.js authentication. Only proxy requests through Next.js.
