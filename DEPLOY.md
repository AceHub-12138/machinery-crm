# DachuanPro ERP 第四期候选版部署手册

适用版本：`v1.5.2-phase4-rc1`

本手册仅供正式维护窗口使用。执行前必须再次确认服务器、正式数据库、PM2 服务名、Nginx 站点文件、正式程序目录和外置上传目录。任何目标不明确时立即停止。禁止执行 `prisma migrate reset`、`db:reset`、`DROP DATABASE`、`TRUNCATE` 或覆盖上传目录。

## 1. 维护窗口前确认

以下变量只是建议值，必须依据服务器当前实际状态确认后再设置：

```bash
export RELEASE_TAG='erp-phase4-rc1-20260715'
export PACKAGE_DIR='/opt/machinery-crm-package'
export RELEASES_DIR='/opt/machinery-crm-releases'
export CURRENT_DIR='/opt/machinery-crm-v108-release'
export RELEASE_DIR="$RELEASES_DIR/$RELEASE_TAG"
export PROGRAM_BACKUP="/opt/crm-backups/program-$RELEASE_TAG-$(date +%Y%m%d-%H%M%S)"
export DB_BACKUP="/opt/crm-backups/database-$RELEASE_TAG-$(date +%Y%m%d-%H%M%S).sql.gz"
export PM2_SERVICE='machinery-crm'
export PRECHECK_SERVICE='machinery-crm-phase4-precheck'
export PROD_PORT='3000'
export PRECHECK_PORT='3109'
```

只读确认现状：

```bash
pwd
pm2 list
pm2 describe "$PM2_SERVICE"
nginx -T
test -d "$CURRENT_DIR"
test -f "$CURRENT_DIR/.env"
stat -c '%a %U:%G %n' "$CURRENT_DIR/.env"
```

确认 `.env` 中数据库目标时只输出主机、端口、库名和用户，不输出密码：

```bash
cd "$CURRENT_DIR"
set -a
. ./.env
set +a
node -e 'const u=new URL(process.env.DATABASE_URL); console.log(JSON.stringify({protocol:u.protocol,host:u.hostname,port:u.port,database:u.pathname.slice(1),user:u.username}))'
unset DATABASE_URL
```

若库名、主机、端口或程序路径与当前正式环境不符，立即停止。

## 2. 备份正式数据库

使用临时 MySQL 客户端配置，密码交互输入且不回显：

```bash
install -m 600 /dev/null /root/phase4-release-mysql.cnf
read -r -p 'MySQL host: ' DB_HOST
read -r -p 'MySQL port: ' DB_PORT
read -r -p 'MySQL user: ' DB_USER
read -r -s -p 'MySQL password: ' DB_PASSWORD
printf '\n'
read -r -p 'Production database name: ' DB_NAME
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" > /root/phase4-release-mysql.cnf
unset DB_PASSWORD
mkdir -p /opt/crm-backups
mysqldump --defaults-extra-file=/root/phase4-release-mysql.cnf --single-transaction --routines --triggers --events --hex-blob --default-character-set=utf8mb4 "$DB_NAME" | gzip -1 > "$DB_BACKUP"
gzip -t "$DB_BACKUP"
sha256sum "$DB_BACKUP" > "$DB_BACKUP.sha256"
chmod 600 "$DB_BACKUP" "$DB_BACKUP.sha256"
```

备份失败、压缩校验失败或文件异常偏小时立即停止。

## 3. 备份当前线上程序

```bash
mkdir -p /opt/crm-backups
cp -a "$CURRENT_DIR" "$PROGRAM_BACKUP"
test -f "$PROGRAM_BACKUP/.env"
test -f "$PROGRAM_BACKUP/start-standalone.cjs"
```

外置上传目录不包含在发布包中。必须单独确认并备份实际 `UPLOAD_DIR`，不得猜测路径：

```bash
set -a
. "$CURRENT_DIR/.env"
set +a
printf '%s\n' "$UPLOAD_DIR"
test -n "$UPLOAD_DIR"
test -d "$UPLOAD_DIR"
```

确认路径无误后，按服务器容量采用快照、`cp -a` 或 `rsync -a` 备份该目录。

## 4. 上传并解压新版本

将已审计的 tar.gz 上传到 `$PACKAGE_DIR`，然后核对交付报告中的 SHA256：

```bash
mkdir -p "$PACKAGE_DIR" "$RELEASES_DIR"
cd "$PACKAGE_DIR"
sha256sum machinery-crm-v1.5.2-phase4-rc1-prebuilt-standalone-linux-x64-*.tar.gz
mkdir -p "$RELEASE_DIR"
tar -xzf machinery-crm-v1.5.2-phase4-rc1-prebuilt-standalone-linux-x64-*.tar.gz -C "$RELEASE_DIR" --strip-components=1
test -f "$RELEASE_DIR/server.js"
test -f "$RELEASE_DIR/start-standalone.cjs"
test -f "$RELEASE_DIR/VERSION"
test -f "$RELEASE_DIR/DEPLOY.md"
test -f "$RELEASE_DIR/ROLLBACK.md"
test -d "$RELEASE_DIR/.next/static"
test -d "$RELEASE_DIR/prisma/migrations"
```

## 5. 沿用正式环境变量

只复制当前正式 `.env`，不得使用发布包或测试环境文件替代：

```bash
cp -p "$CURRENT_DIR/.env" "$RELEASE_DIR/.env"
chmod 600 "$RELEASE_DIR/.env"
```

再次执行第 1 节的脱敏目标检查，并确认 `UPLOAD_DIR` 仍指向当前外置上传目录。

## 6. 执行 Prisma migration

仅使用成品包中的 Prisma CLI 和 migration；先检查，再部署，再复查：

```bash
cd "$RELEASE_DIR"
node node_modules/prisma/build/index.js -v
node node_modules/prisma/build/index.js migrate status --schema=prisma/schema.prisma
node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma
node node_modules/prisma/build/index.js migrate status --schema=prisma/schema.prisma
```

成功标准是 migration 全部应用且最终显示数据库结构已是最新状态。出现失败、未知历史迁移、库名不符或结构冲突时立即停止，不启动新程序。

## 7. 临时端口预启动

临时实例只监听服务器本机：

```bash
cd "$RELEASE_DIR"
HOSTNAME=127.0.0.1 PORT="$PRECHECK_PORT" NODE_ENV=production pm2 start start-standalone.cjs --name "$PRECHECK_SERVICE" --update-env
pm2 describe "$PRECHECK_SERVICE"
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PRECHECK_PORT/login"
```

预期登录页 HTTP 200。使用浏览器完成正式账号登录后，验证 ERP 页面与只读列表 API；未登录访问 ERP API 应被 307、401 或 403 拒绝。

Cron 鉴权先验证缺少密钥必定返回 401 或 403：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://127.0.0.1:$PRECHECK_PORT/api/erp/kit-rechecks/process"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://127.0.0.1:$PRECHECK_PORT/api/erp/delivery-reminders/run"
```

带密钥调用可能处理正式队列或创建正式提醒，只能在维护负责人确认后执行；密钥必须通过权限 600 的临时 curl 配置传入，不得写入命令历史或日志。重复调用应保持幂等。

## 8. PM2 与 Nginx 切换

先记录现有 PM2 配置和 Nginx 配置文件路径。若 Nginx 始终代理固定的 `127.0.0.1:$PROD_PORT`，无需修改 Nginx，只需将正式 PM2 服务切换到新目录并继续监听相同端口：

```bash
pm2 describe "$PM2_SERVICE"
pm2 stop "$PRECHECK_SERVICE"
pm2 delete "$PRECHECK_SERVICE"
pm2 stop "$PM2_SERVICE"
pm2 delete "$PM2_SERVICE"
cd "$RELEASE_DIR"
HOSTNAME=127.0.0.1 PORT="$PROD_PORT" NODE_ENV=production pm2 start start-standalone.cjs --name "$PM2_SERVICE" --update-env
pm2 save
pm2 describe "$PM2_SERVICE"
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PROD_PORT/login"
```

如果实际 Nginx 使用版本化 upstream 或端口发生变化，先备份已确认的站点文件，再人工只改 upstream 目标：

```bash
export NGINX_SITE='/confirmed/path/to/site.conf'
cp -a "$NGINX_SITE" "$NGINX_SITE.before-$RELEASE_TAG"
nginx -t
systemctl reload nginx
```

不得在未确认站点文件和 upstream 的情况下自动替换。`nginx -t` 失败时不得 reload。

## 9. 正式切换后检查

依次验证：

1. PM2 进程 `online`，工作目录和 Commit/版本与候选版一致。
2. Nginx、域名和 `/login` 正常，无 502、循环跳转或静态资源 404。
3. 超级管理员可登录；普通销售权限未扩大；仓库、采购角色边界正确。
4. 客户、合同、回款、发货等原 CRM 页面只读抽查正常。
5. ERP 物料、库存、BOM、采购需求、采购订单、生产工单、月度计划和供应商交期页面正常。
6. 未登录 ERP API 与缺少 Cron 密钥请求均被拒绝。
7. 经维护负责人批准后执行两类 Cron 两次，确认第二次不产生重复齐套结果或提醒。
8. 外置上传目录可读写，历史附件存在，发布目录内没有新的业务上传文件。
9. `pm2 logs "$PM2_SERVICE" --lines 100` 无数据库字段缺失、Prisma 初始化、模块缺失或未处理异常。

## 10. 立即停止条件

- 数据库目标、程序目录、上传目录、PM2 服务或 Nginx 站点不明确。
- 备份失败、SHA256 不符、成品包结构不完整或 `.env` 丢失。
- migration 失败、历史迁移不一致、出现未知字段/表或需要破坏性重置。
- 临时实例无法启动、登录失败、权限扩大、Cron 无密钥仍可执行或幂等失败。
- 发现可能影响线上数据、上传目录或现有 CRM 主链路的异常。

触发任一条件后保留日志与备份，停止切换并按 `ROLLBACK.md` 评估恢复。
