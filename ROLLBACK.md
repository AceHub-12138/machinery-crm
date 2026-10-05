# DachuanPro ERP 第四期候选版回滚手册

适用版本：`v1.5.2-phase4-rc1`

回滚必须在维护负责人确认后执行。数据库 migration 与应用版本必须作为一个兼容性整体评估，禁止只回滚程序而不判断旧程序能否兼容新结构和新业务数据。

## 1. 回滚前判断

立即停止新版本切换，并记录：

```bash
pm2 list
pm2 describe machinery-crm
pm2 logs machinery-crm --lines 100
nginx -T
```

确认以下变量指向本次部署时实际生成的路径，不得猜测：

```bash
export PM2_SERVICE='machinery-crm'
export FAILED_RELEASE='/opt/machinery-crm-releases/erp-phase4-rc1-20260715'
export PROGRAM_BACKUP='/opt/crm-backups/confirmed-program-backup-directory'
export DB_BACKUP='/opt/crm-backups/confirmed-database-backup.sql.gz'
export PROD_PORT='3000'
```

## 2. 程序与 PM2 回切

若旧程序确认兼容当前数据库结构，可先回切程序：

```bash
pm2 stop "$PM2_SERVICE"
pm2 delete "$PM2_SERVICE"
cd "$PROGRAM_BACKUP"
HOSTNAME=127.0.0.1 PORT="$PROD_PORT" NODE_ENV=production pm2 start start-standalone.cjs --name "$PM2_SERVICE" --update-env
pm2 save
pm2 describe "$PM2_SERVICE"
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PROD_PORT/login"
```

不要删除失败的新版本目录；保留它用于审计和问题定位。外置上传目录不得删除、清空或被旧发布包覆盖。

## 3. Nginx 回切

若部署时没有修改 Nginx 且仍代理固定正式端口，不需要改动。若修改过已确认的站点文件，恢复部署前副本：

```bash
export NGINX_SITE='/confirmed/path/to/site.conf'
export NGINX_BACKUP='/confirmed/path/to/site.conf.before-erp-phase4-rc1-20260715'
cp -a "$NGINX_BACKUP" "$NGINX_SITE"
nginx -t
systemctl reload nginx
```

`nginx -t` 失败时不得 reload，应恢复到最近一次语法通过的配置。

## 4. 数据库回滚条件

只有同时满足以下条件时才能恢复上线前数据库备份：

1. 新版本已经停止，维护窗口内禁止继续写入。
2. 已确认恢复会覆盖上线后的全部新增和修改数据，业务负责人接受数据损失范围。
3. 备份文件及其 SHA256 校验通过。
4. 已再次备份当前故障数据库，供审计和必要的数据补录。
5. 已确认目标数据库名称、主机和端口，且恢复命令不会连接其他数据库。

若 migration 已成功且旧程序可兼容新增表/字段，优先只回切程序并保留数据库。若上线后已经产生采购需求、月度计划、调拨、交期、通知或附件记录，不得直接执行 migration 目录中的 `rollback.sql`；应先评估数据保留和补录方案。

## 5. 数据库备份恢复

先为当前故障状态生成第二份备份，再使用权限 600 的 MySQL 客户端配置。密码必须交互输入且不回显。禁止把上线前备份直接导入仍含新表和新数据的原库，因为普通 SQL 导入不会自动删除新增结构，不能形成精确恢复。

先恢复到一个经过确认的全新恢复库：

```bash
gzip -t "$DB_BACKUP"
sha256sum -c "$DB_BACKUP.sha256"
install -m 600 /dev/null /root/phase4-rollback-mysql.cnf
read -r -p 'MySQL host: ' DB_HOST
read -r -p 'MySQL port: ' DB_PORT
read -r -p 'MySQL user: ' DB_USER
read -r -s -p 'MySQL password: ' DB_PASSWORD
printf '\n'
read -r -p 'Production database name: ' DB_NAME
read -r -p 'New recovery database name: ' RECOVERY_DB
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" > /root/phase4-rollback-mysql.cnf
unset DB_PASSWORD
mysqldump --defaults-extra-file=/root/phase4-rollback-mysql.cnf --single-transaction --routines --triggers --events --hex-blob --default-character-set=utf8mb4 "$DB_NAME" | gzip -1 > "/opt/crm-backups/pre-restore-failed-state-$(date +%Y%m%d-%H%M%S).sql.gz"
[[ "$RECOVERY_DB" =~ ^[A-Za-z0-9_]+$ ]]
mysql --defaults-extra-file=/root/phase4-rollback-mysql.cnf --execute="CREATE DATABASE \`$RECOVERY_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
gzip -dc "$DB_BACKUP" | mysql --defaults-extra-file=/root/phase4-rollback-mysql.cnf "$RECOVERY_DB"
```

恢复后先在恢复库核对关键表、数据基线与旧程序 migration 状态。只有验证通过后，才由维护负责人把旧程序 `.env` 的数据库目标切换到恢复库；不得在命令或日志中输出完整连接串。随后启动旧程序：

```bash
cd "$PROGRAM_BACKUP"
node node_modules/prisma/build/index.js migrate status --schema=prisma/schema.prisma
pm2 restart "$PM2_SERVICE" --update-env
pm2 save
```

确认工作结束后安全删除临时客户端配置：

```bash
shred -u /root/phase4-release-mysql.cnf 2>/dev/null || true
shred -u /root/phase4-rollback-mysql.cnf 2>/dev/null || true
unset DB_HOST DB_PORT DB_USER DB_NAME RECOVERY_DB
```

## 6. 回滚后检查

1. `/login`、静态资源、域名和 Nginx 状态正常。
2. PM2 使用确认过的旧程序目录和正式 `.env`。
3. CRM 客户、合同、回款、发货主链路可读写。
4. ERP 旧功能与权限边界正常。
5. 外置上传目录与历史附件完整。
6. 数据库恢复时，记录被覆盖的数据时间范围，并安排业务补录。

数据库恢复是高风险最终手段。没有备份校验、目标确认、停写窗口和业务负责人批准时不得执行。
