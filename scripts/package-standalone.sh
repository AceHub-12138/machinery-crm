#!/usr/bin/env bash
# 组装并校验 standalone 成品包（复刻 .github/workflows/build-standalone.yml 打包阶段，
# GitHub 封禁后改为本地 Docker Desktop 构建时在 Linux 容器内执行）。
# 用法: bash scripts/package-standalone.sh <GIT_SHA> <GIT_REF>
set -Eeuo pipefail
trap 'echo "打包脚本在第 ${LINENO} 行失败（exit=$?）" >&2' ERR

GIT_SHA="${1:-unknown}"
GIT_REF="${2:-unknown}"

APP_NAME="machinery-crm"
VERSION="$(tr -d '\r\n' < VERSION)"
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]]
STAMP="$(date +%Y-%m-%d-%H%M)"
OUT_DIR="$PWD/dist"
PKG_DIR="$OUT_DIR/${APP_NAME}-${VERSION}-prebuilt-standalone-linux-x64"
PKG_FILE="$OUT_DIR/${APP_NAME}-${VERSION}-prebuilt-standalone-linux-x64-${STAMP}.tar.gz"

rm -rf "$PKG_DIR"
mkdir -p "$OUT_DIR"

# 4. 准备独立包目录
mkdir -p "$PKG_DIR"
cp -a .next/standalone/. "$PKG_DIR/"

# Materialize pnpm symlinks so control panels or ZIP tools cannot
# turn them into plain text files during deployment. Broken links
# left by optional packages are removed.
PKG_DIR="$PKG_DIR" python3 <<'PY'
import os
import shutil
from pathlib import Path

root = Path(os.environ["PKG_DIR"])

for _ in range(20):
    links = [path for path in root.rglob("*") if path.is_symlink()]
    if not links:
        break

    for link in sorted(links, key=lambda path: len(path.parts), reverse=True):
        if not link.is_symlink():
            continue

        target = link.resolve(strict=False)
        link.unlink()

        if not target.exists():
            continue

        if target.is_dir():
            shutil.copytree(target, link, symlinks=True)
        else:
            shutil.copy2(target, link)
else:
    raise RuntimeError("Too many symlink expansion passes")
PY

# 5. 补齐 Next standalone 不会自动复制的静态资源
mkdir -p "$PKG_DIR/.next"
cp -a .next/static "$PKG_DIR/.next/static"
if [[ -d public ]]; then
  cp -a public "$PKG_DIR/public"
fi

# 6. 补齐 Prisma schema、migrations、运行时引擎
mkdir -p "$PKG_DIR/prisma"
cp -a prisma/schema.prisma "$PKG_DIR/prisma/schema.prisma"
if [[ -d prisma/migrations ]]; then
  rm -rf "$PKG_DIR/prisma/migrations"
  mkdir -p "$PKG_DIR/prisma/migrations"
  cp -a prisma/migrations/. "$PKG_DIR/prisma/migrations/"
fi

mkdir -p "$PKG_DIR/node_modules"
if [[ -d node_modules/.prisma ]]; then
  cp -aL node_modules/.prisma "$PKG_DIR/node_modules/.prisma"
else
  PRISMA_CLIENT_DIR="$(find node_modules -path '*/.prisma/client' -type d -print -quit)"
  if [[ -n "$PRISMA_CLIENT_DIR" ]]; then
    mkdir -p "$PKG_DIR/node_modules/.prisma"
    cp -aL "$(dirname "$PRISMA_CLIENT_DIR")/." "$PKG_DIR/node_modules/.prisma/"
  fi
fi
if [[ -d node_modules/@prisma ]]; then
  rm -rf "$PKG_DIR/node_modules/@prisma"
  mkdir -p "$PKG_DIR/node_modules/@prisma"
  cp -aL node_modules/@prisma/. "$PKG_DIR/node_modules/@prisma/"
fi
# 可选但推荐：保留 Prisma CLI 包，方便 fallback / 排查
if [[ -d node_modules/prisma ]]; then
  cp -aL node_modules/prisma "$PKG_DIR/node_modules/prisma"
fi

# pnpm keeps many transitive packages under .pnpm instead of exposing
# them as top-level node_modules entries. The standalone server and
# Prisma CLI resolve from the extracted package root, so materialize
# the runtime packages that must be available at that root.
PKG_DIR="$PKG_DIR" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const pkgDir = process.env.PKG_DIR;
const rootRequire = createRequire(path.join(process.cwd(), "package.json"));

function requireFromPackage(packageName) {
  const packageJson = rootRequire.resolve(`${packageName}/package.json`);
  return createRequire(packageJson);
}

const resolvers = {
  root: rootRequire,
  next: requireFromPackage("next"),
  prisma: requireFromPackage("prisma"),
};

const runtimePackages = [
  { name: "@swc/helpers", from: "next" },
  { name: "@next/env", from: "next" },
  { name: "prisma", from: "root" },
  { name: "@prisma/client", from: "root" },
  { name: "@prisma/engines", from: "prisma" },
  { name: "@prisma/debug", from: "prisma" },
  { name: "@prisma/config", from: "prisma" },
  { name: "@prisma/engines-version", from: "prisma" },
  { name: "@prisma/fetch-engine", from: "prisma" },
  { name: "@prisma/get-platform", from: "prisma" },
  { name: "jiti", from: "prisma" },
];

function packageRoot(packageName, resolver) {
  try {
    return path.dirname(resolver.resolve(`${packageName}/package.json`));
  } catch {
    const entry = resolver.resolve(packageName);
    let dir = path.dirname(entry);
    while (dir !== path.parse(dir).root) {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
      dir = path.dirname(dir);
    }
    throw new Error(`Unable to locate package root for ${packageName}`);
  }
}

function destination(packageName) {
  return path.join(pkgDir, "node_modules", ...packageName.split("/"));
}

for (const spec of runtimePackages) {
  const source = packageRoot(spec.name, resolvers[spec.from]);
  const target = destination(spec.name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  console.log(`Copied ${spec.name} from ${source}`);
}
NODE

# 7. 放入启动脚本和部署说明
# src/ 源码一并放入：与既有发布包结构一致（支撑服务器 fallback 部署，
# 且包内校验会读取 src/lib/changelog.ts）
cp -a src "$PKG_DIR/src"
cp -a start-standalone.cjs "$PKG_DIR/start-standalone.cjs"
cp -a package.json "$PKG_DIR/package.json"
PKG_JSON="$PKG_DIR/package.json" node <<'NODE'
const fs = require("node:fs");
const file = process.env.PKG_JSON;
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.scripts = { start: "node start-standalone.cjs" };
delete pkg.devDependencies;
delete pkg.prisma;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
NODE
cp -a pnpm-lock.yaml "$PKG_DIR/pnpm-lock.yaml"
cp -a VERSION "$PKG_DIR/VERSION"
cp -a CHANGELOG.md "$PKG_DIR/CHANGELOG.md"
cp -a DEPLOY.md "$PKG_DIR/DEPLOY.md"
cp -a ROLLBACK.md "$PKG_DIR/ROLLBACK.md"
if [[ -f .env.xiaochuan.example ]]; then
  cp -a .env.xiaochuan.example "$PKG_DIR/.env.xiaochuan.example"
fi
{
  printf 'VERSION=%s\n' "$VERSION"
  printf 'GIT_SHA=%s\n' "$GIT_SHA"
  printf 'GIT_REF=%s\n' "$GIT_REF"
  printf 'BUILDER=%s\n' "docker-desktop-local"
  printf 'BUILD_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$PKG_DIR/BUILD_INFO"
if [[ -f STANDALONE_DEPLOY.md ]]; then
  cp -a STANDALONE_DEPLOY.md "$PKG_DIR/STANDALONE_DEPLOY.md"
fi
if [[ -f deploy_standalone_low_memory.sh ]]; then
  cp -a deploy_standalone_low_memory.sh "$PKG_DIR/deploy_standalone_low_memory.sh"
  chmod +x "$PKG_DIR/deploy_standalone_low_memory.sh"
fi

# 8. 校验关键文件
test -f "$PKG_DIR/.next/standalone/server.js" || test -f "$PKG_DIR/server.js"
test -d "$PKG_DIR/.next/static"
find "$PKG_DIR/.next/static" -type f -name '*.css' -print -quit | grep -q .
find "$PKG_DIR/.next/static" -type f -name '*.js' -print -quit | grep -q .
test -f "$PKG_DIR/prisma/schema.prisma"
test "$(tr -d '\r\n' < "$PKG_DIR/VERSION")" = "$VERSION"
test -f "$PKG_DIR/BUILD_INFO"
test -f "$PKG_DIR/DEPLOY.md"
test -f "$PKG_DIR/ROLLBACK.md"
test ! -d "$PKG_DIR/prisma/migrations/migrations"

SOURCE_MIGRATION_COUNT="$(
  find prisma/migrations \
    -mindepth 1 -maxdepth 1 -type d | wc -l
)"
PACKAGE_MIGRATION_COUNT="$(
  find "$PKG_DIR/prisma/migrations" \
    -mindepth 1 -maxdepth 1 -type d | wc -l
)"
echo "源码migration数量：$SOURCE_MIGRATION_COUNT"
echo "包内migration数量：$PACKAGE_MIGRATION_COUNT"
if [[ "$SOURCE_MIGRATION_COUNT" -ne "$PACKAGE_MIGRATION_COUNT" ]]; then
  echo "Migration数量不一致：源码=$SOURCE_MIGRATION_COUNT，包内=$PACKAGE_MIGRATION_COUNT"
  exit 1
fi
while IFS= read -r migration_dir; do
  if [[ ! -f "$migration_dir/migration.sql" ]]; then
    echo "无效migration目录：$migration_dir"
    exit 1
  fi
done < <(
  find "$PKG_DIR/prisma/migrations" \
    -mindepth 1 -maxdepth 1 -type d -print
)
echo "包内migration名称："
find "$PKG_DIR/prisma/migrations" \
  -mindepth 1 -maxdepth 1 -type d \
  -printf '%f\n' | sort
migration_manifest() {
  local root="$1"
  while IFS= read -r relative_path; do
    printf '%s  %s\n' "$(sha256sum "$root/$relative_path" | awk '{print $1}')" "$relative_path"
  done < <(find "$root" -mindepth 2 -maxdepth 2 -type f -name migration.sql -printf '%P\n' | sort)
}
migration_manifest prisma/migrations > "$OUT_DIR/source-migrations.sha256"
migration_manifest "$PKG_DIR/prisma/migrations" > "$OUT_DIR/package-migrations.sha256"
diff -u "$OUT_DIR/source-migrations.sha256" "$OUT_DIR/package-migrations.sha256"
find "$PKG_DIR/node_modules/.prisma/client" -name 'libquery_engine-*.so.node' -print -quit | grep -q .
test -z "$(find "$PKG_DIR" -type l -print -quit)"
test ! -e "$PKG_DIR/.env"
test ! -d "$PKG_DIR/src/app/uploads"
PKG_DIR="$PKG_DIR" node <<'NODE'
const path = require("node:path");
const { createRequire } = require("node:module");

const pkgDir = process.env.PKG_DIR;
const serverRequire = createRequire(path.join(pkgDir, "server.js"));
const packageRequire = createRequire(path.join(pkgDir, "package.json"));
const modules = [
  { name: "@swc/helpers/_/_interop_require_default", resolver: serverRequire },
  { name: "@next/env", resolver: serverRequire },
  { name: "@prisma/engines", resolver: packageRequire },
  { name: "@prisma/debug", resolver: packageRequire },
  { name: "@prisma/config", resolver: packageRequire },
  { name: "@prisma/fetch-engine", resolver: packageRequire },
  { name: "@prisma/get-platform", resolver: packageRequire },
];

for (const mod of modules) {
  console.log(`${mod.name} -> ${mod.resolver.resolve(mod.name)}`);
}
NODE
node "$PKG_DIR/node_modules/prisma/build/index.js" -v

# 9. 打 tar.gz，归档内保留一个顶层目录
tar -C "$OUT_DIR" -czf "$PKG_FILE" "$(basename "$PKG_DIR")"

# Verify the exact tarball shape after extraction, not just the staging
# directory, so the package never ships in a state that cannot resolve
# runtime dependencies from the extracted root.
VERIFY_DIR="$OUT_DIR/verify-extract"
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"
tar -xzf "$PKG_FILE" -C "$VERIFY_DIR"
VERIFY_APP="$VERIFY_DIR/$(basename "$PKG_DIR")"
test -f "$VERIFY_APP/server.js"
test -f "$VERIFY_APP/start-standalone.cjs"
test -f "$VERIFY_APP/VERSION"
test -f "$VERIFY_APP/BUILD_INFO"
test -f "$VERIFY_APP/DEPLOY.md"
test -f "$VERIFY_APP/ROLLBACK.md"
test -d "$VERIFY_APP/.next/static"
find "$VERIFY_APP/.next/static" -type f -name '*.css' -print -quit | grep -q .
find "$VERIFY_APP/.next/static" -type f -name '*.js' -print -quit | grep -q .
test ! -d "$VERIFY_APP/prisma/migrations/migrations"
test ! -e "$VERIFY_APP/.env"
test ! -d "$VERIFY_APP/src/app/uploads"
VERIFY_MIGRATION_COUNT="$(
  find "$VERIFY_APP/prisma/migrations" \
    -mindepth 1 -maxdepth 1 -type d | wc -l
)"
echo "解压后migration数量：$VERIFY_MIGRATION_COUNT"
if [[ "$VERIFY_MIGRATION_COUNT" -ne "$SOURCE_MIGRATION_COUNT" ]]; then
  echo "解压后migration数量错误：$VERIFY_MIGRATION_COUNT"
  exit 1
fi
while IFS= read -r migration_dir; do
  if [[ ! -f "$migration_dir/migration.sql" ]]; then
    echo "解压后发现无migration.sql目录：$migration_dir"
    exit 1
  fi
done < <(
  find "$VERIFY_APP/prisma/migrations" \
    -mindepth 1 -maxdepth 1 -type d -print
)
migration_manifest "$VERIFY_APP/prisma/migrations" > "$OUT_DIR/extracted-migrations.sha256"
diff -u "$OUT_DIR/source-migrations.sha256" "$OUT_DIR/extracted-migrations.sha256"
test -f "$VERIFY_APP/prisma/migrations/20260903090000_add_xiaochuan_agent_conversations/migration.sql"
test -f "$VERIFY_APP/prisma/migrations/20260903110000_add_agent_message_error_flag/migration.sql"
test -f "$VERIFY_APP/.next/server/app/(app)/erp/bom/page.js"
test -f "$VERIFY_APP/.next/server/app/api/erp/boms/route.js"
test -f "$VERIFY_APP/.next/server/app/api/erp/boms/[id]/route.js"
test ! -e "$VERIFY_APP/.next/server/app/api/erp/boms/[id]/requirements/route.js"
test -f "$VERIFY_APP/.next/server/app/api/erp/products/route.js"
test -f "$VERIFY_APP/.next/server/app/(app)/erp/monthly-production-plans/page.js"
test -f "$VERIFY_APP/.next/server/app/api/erp/monthly-spare-parts-forecasts/route.js"
test -f "$VERIFY_APP/.next/server/app/(app)/erp/purchase-demands/page.js"
test -f "$VERIFY_APP/.next/server/app/api/erp/delivery-reminders/run/route.js"
test -f "$VERIFY_APP/.next/server/app/api/erp/kit-rechecks/process/route.js"
# 小川第 1 期：独立全屏路由 + Agent API 必须在包内
test -f "$VERIFY_APP/.next/server/app/xiaochuan/page.js"
test -f "$VERIFY_APP/.next/server/app/api/agent/chat/route.js"
test -f "$VERIFY_APP/.next/server/app/api/agent/conversations/route.js"
test -f "$VERIFY_APP/.next/server/app/api/agent/conversations/[id]/route.js"
grep -q "version: \"$VERSION\"" "$VERIFY_APP/src/lib/changelog.ts"
# package.json 的 npm 版本号与 VERSION 必须同源（v1.5.2-phase4-rc2 ↔ 1.5.2-rc.2）；
# 这里不再写死版本号，改由 VERSION 推导，避免每次发版都要改断言
PKG_VERSION="$(node -e 'process.stdout.write(require("./package.json").version)')"
node -e 'const p=require(process.argv[1]); if(p.version!==process.argv[2]) process.exit(1)' "$VERIFY_APP/package.json" "$PKG_VERSION"
# 排除打包脚本自身：NFT 全项目追踪会把本脚本拷进 standalone，
# 而本脚本必然包含下面这些模式字面量
if grep -RIlE 'machinery_crm_sandbox|phase4-mysql57|127\.0\.0\.1:3307|127\.0\.0\.1:3108|phase4-admin@example\.invalid' "$VERIFY_APP" --exclude=package-standalone.sh; then
  echo 'Sandbox-only marker found in candidate package' >&2
  exit 1
fi
PKG_DIR="$VERIFY_APP" node <<'NODE'
const path = require("node:path");
const { createRequire } = require("node:module");

const pkgDir = process.env.PKG_DIR;
const serverRequire = createRequire(path.join(pkgDir, "server.js"));
const packageRequire = createRequire(path.join(pkgDir, "package.json"));
const modules = [
  { name: "@swc/helpers/_/_interop_require_default", resolver: serverRequire },
  { name: "@next/env", resolver: serverRequire },
  { name: "@prisma/engines", resolver: packageRequire },
  { name: "@prisma/debug", resolver: packageRequire },
  { name: "@prisma/config", resolver: packageRequire },
  { name: "@prisma/fetch-engine", resolver: packageRequire },
  { name: "@prisma/get-platform", resolver: packageRequire },
];

for (const mod of modules) {
  console.log(`${mod.name} -> ${mod.resolver.resolve(mod.name)}`);
}
NODE
node "$VERIFY_APP/node_modules/prisma/build/index.js" -v

SMOKE_LOG="$VERIFY_DIR/server.log"
PERSISTENT_UPLOADS="$VERIFY_DIR/persistent-uploads"
mkdir -p "$PERSISTENT_UPLOADS"
printf 'standalone-upload-persistence-check\n' > "$PERSISTENT_UPLOADS/restart-marker.txt"
PORT=3000 HOSTNAME=127.0.0.1 UPLOAD_DIR="$PERSISTENT_UPLOADS" node "$VERIFY_APP/server.js" >"$SMOKE_LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

STATUS=""
for _ in {1..30}; do
  STATUS="$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login || true)"
  if [[ "$STATUS" =~ ^(200|302|307)$ ]]; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$SMOKE_LOG"
    exit 1
  fi
  sleep 1
done

if [[ ! "$STATUS" =~ ^(200|302|307)$ ]]; then
  cat "$SMOKE_LOG"
  echo "Smoke check failed with HTTP status: ${STATUS:-none}"
  exit 1
fi

# 小川页未登录应可访问或重定向到登录页（不能 500/404）
STATUS_XC="$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/xiaochuan || true)"
if [[ ! "$STATUS_XC" =~ ^(200|302|307)$ ]]; then
  cat "$SMOKE_LOG"
  echo "Xiaochuan smoke check failed with HTTP status: ${STATUS_XC:-none}"
  exit 1
fi
echo "冒烟通过：/login=$STATUS /xiaochuan=$STATUS_XC"

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" || true
trap - EXIT
test -f "$PERSISTENT_UPLOADS/restart-marker.txt"

PORT=3000 HOSTNAME=127.0.0.1 UPLOAD_DIR="$PERSISTENT_UPLOADS" node "$VERIFY_APP/start-standalone.cjs" >>"$SMOKE_LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
STATUS=""
for _ in {1..30}; do
  STATUS="$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login || true)"
  if [[ "$STATUS" =~ ^(200|302|307)$ ]]; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$SMOKE_LOG"
    exit 1
  fi
  sleep 1
done
test "$STATUS" = "200"
node <<'NODE'
const assert = require("node:assert/strict");

async function main() {
  const origin = "http://127.0.0.1:3000";
  const login = await fetch(`${origin}/login`);
  assert.equal(login.status, 200, "Login page is unavailable");
  const html = await login.text();
  const assets = [...new Set(
    [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)(?:\?[^\"]*)?"/g)]
      .map((match) => match[1])
  )];
  assert(assets.length > 0, "Login HTML has no Next static assets");
  for (const asset of assets) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200, `Login static asset is unavailable: ${asset}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
test -f "$PERSISTENT_UPLOADS/restart-marker.txt"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" || true
trap - EXIT
rm -rf "$VERIFY_DIR"

echo "OK: $PKG_FILE"
sha256sum "$PKG_FILE"
ls -lh "$PKG_FILE"
