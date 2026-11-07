# 发布、验收与回滚（只提供步骤，由用户执行）

本次未访问服务器、未执行数据库迁移、未请求真实搜索/模型/天眼查。真实服务联调会产生供应商调用，必须由管理员核对账户、Token、服务权限和额度后手动进行。

## 1. 发布前条件

1. 先完成代码复审及独立 MySQL 5.7 测试库的 migration → rollback → migration 验证。本机 Docker 引擎不可用，尚未完成这一项，不能直接据此上线。
2. 确认实际项目目录、持久化上传目录、数据库名、PM2 名称、端口、Nginx 代理和环境变量。历史路径仅作参考，不直接套用。
3. 确认上传目录在项目外持久化，且 `.env` 的 UPLOAD_DIR 正确；如果上传仍在项目内，先停止本次发布并单独制定保全方案。
4. 本次不合并 main、不在服务器构建。审核后，在 GitHub Actions 的 standalone 构建工作流选择本分支的精确提交，下载 Linux 发布包并核对 SHA-256。
5. 确认包内 migration、Prisma CLI 和引擎能在独立执行目录使用。标准 standalone 包可能只含运行时 Client，缺少 CLI 时停止，不要在生产临时安装依赖。
6. 确认 Prisma migration 历史与生产实际一致。若 `migrate status` 提示历史缺失、失败或漂移，停止，不使用 reset、db push 或批量 resolve 掩盖问题。

下列命令分段执行；任一命令失败立即停止。所有变量都须填写已核对的真实值，不能原样输入“填写…”占位符。密码放在权限为 600 的 MySQL 客户端配置中，不写进命令或日志。

## 2. 核对和备份

先在 Bash 中设置已确认的路径和服务名：

```bash
set -euo pipefail
umask 077
read -r -p '已确认的当前项目绝对路径：' CRM_DIR
read -r -p '已确认的上传目录绝对路径：' UPLOAD_DIR
read -r -p '本次专用、尚不存在的备份目录绝对路径：' BACKUP_DIR
read -r -p '已确认的 PM2 服务名：' PM2_APP
read -r -p '权限为 600 的 MySQL 客户端配置路径：' MYSQL_BACKUP_CONFIG
read -r -p '数据库名：' DB_NAME
test -d "$CRM_DIR"
test -d "$UPLOAD_DIR"
test -f "$CRM_DIR/.env"
test -f "$MYSQL_BACKUP_CONFIG"
test -n "$DB_NAME"
test -n "$PM2_APP"
test ! -e "$BACKUP_DIR"
mkdir -m 700 "$BACKUP_DIR"
```

作用：确认目录存在并创建私有备份目录。正常时无错误；不要打印 `.env` 或客户端配置内容。

```bash
pm2 list
nginx -t
```

作用：确认现有服务运行、Nginx 配置有效。正常时 PM2 为 online、Nginx 提示 successful。只核对，不修改配置。

```bash
tar -czf "$BACKUP_DIR/project.tar.gz" -C "$CRM_DIR" .
tar -czf "$BACKUP_DIR/uploads.tar.gz" -C "$UPLOAD_DIR" .
tar -tzf "$BACKUP_DIR/project.tar.gz" > "$BACKUP_DIR/project-files.txt"
gzip -t "$BACKUP_DIR/project.tar.gz"
gzip -t "$BACKUP_DIR/uploads.tar.gz"
```

作用：保留完整旧代码、构建产物、运行依赖及上传文件；正常时检查无输出且退出 0。备份含敏感信息，不上传公开位置。当前项目目录也保留原样，作为快速回滚入口。

```bash
mysqldump --defaults-extra-file="$MYSQL_BACKUP_CONFIG" --column-statistics=0 --single-transaction --routines --triggers --events --hex-blob --default-character-set=utf8mb4 "$DB_NAME" > "$BACKUP_DIR/database.sql"
test -s "$BACKUP_DIR/database.sql"
mysqldump --defaults-extra-file="$MYSQL_BACKUP_CONFIG" --column-statistics=0 --single-transaction --default-character-set=utf8mb4 "$DB_NAME" leads lead_hunt_tasks lead_hunt_candidates > "$BACKUP_DIR/lead-core.sql"
test -s "$BACKUP_DIR/lead-core.sql"
```

作用：全库备份并单独备份 Lead 和全部现有 lead_hunt 表；正常时退出 0 且文件非空。这里按支持 `--column-statistics=0` 的客户端写；MySQL 5.7 客户端如果不支持该参数，先确认客户端版本，再仅去掉该参数，不能忽略其他错误。抽样确认 SQL 结构完整，并在测试环境验证可恢复。

## 3. 准备新目录和数据库迁移

上传发布包，核对它的 SHA-256 与 GitHub Actions 成品记录相同，再设置路径：

```bash
read -r -p '已核验发布包绝对路径：' PACKAGE
read -r -p '本次专用、尚不存在的新版本目录绝对路径：' RELEASE_DIR
test -s "$PACKAGE"
test ! -e "$RELEASE_DIR"
tar -tzf "$PACKAGE" > "$BACKUP_DIR/new-package-files.txt"
```

作用：查看包清单，人工确认只有一个顶层目录、无绝对路径或 `..` 路径、无 `.env` 和 uploads 实体内容；若不是此结构，停止，不直接使用下一条解包命令。

```bash
mkdir -m 700 "$RELEASE_DIR"
tar -xzf "$PACKAGE" -C "$RELEASE_DIR" --strip-components=1
cp -p "$CRM_DIR/.env" "$RELEASE_DIR/.env"
chmod 600 "$RELEASE_DIR/.env"
cd "$RELEASE_DIR"
pnpm exec prisma --version
pnpm exec prisma migrate status
```

作用：解包至新目录，不覆盖旧目录和上传文件；保留原环境变量；检查 CLI 与迁移历史。只有本次迁移待应用且无历史异常时继续。

先审阅 [完整 SQL 与回滚 SQL](migration-review.md)，并确认测试库已通过，再执行：

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status
```

正常时只应用 `20261107010000_add_lead_contact_verification`，随后提示迁移已同步。若出现其他待应用迁移、DDL 失败或锁等待，停止切换代码；保留日志并请审核方处理，禁止强行重置数据库。

DDL 新增列和索引仍可能锁表；安排维护窗口。MySQL DDL 不保证整体事务回滚，半途失败不能盲目再次执行整份 SQL。

## 4. 配置与切换

在安全编辑器中修改新目录 `.env`：填写 QIANFAN_SEARCH_API_KEY，使用反查时填写 LEAD_TYC_TOKEN；默认 LEAD_TYC_DAILY_LIMIT=20、LEAD_TYC_CACHE_DAYS=30。生产 LEAD_TYC_MOCK=0、LEAD_HUNTER_FAKE_SEARCH=0。保留 AUTH_SECRET、数据库、上传、模型配置等原有值。不要在终端回显密钥。

先确认实际 PM2 使用此仓库的 ecosystem 配置，并确认原端口和环境参数；若生产采用其他启动方式，停止并按现有部署方式单独制定切换命令。确认兼容后：

```bash
cd "$RELEASE_DIR"
PM2_APP="$PM2_APP" pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 list
```

作用：同名服务切换到已核验的新版本，正常状态为 online。核对进程实际工作目录、端口和启动文件确属新版本；Nginx 不需要改动。

```bash
curl -fsS https://dachuan.pro/api/health
```

作用：按已确认的实际域名检查健康接口，正常返回健康 JSON。域名不是 dachuan.pro 时换成已确认的域名。随后执行下面的业务验收，全部正常后再运行 `pm2 save` 保存进程配置。

## 5. 页面验收

- 超管：创建任务；84 分不可入池；85 分以上无电话可以入池，未指派；联系人姓名保留。
- 超管：候选中的电话有“网页原文”标签和原文片段；模型给出原文没有的号码时不可保留。
- 超管：线索池待反查只手动发起；同名存续企业有电话时回填并按省份分配；只有邮箱不算成功电话。
- 超管：指定查询全称返回不同企业时仍进入待确认；左右对照、曾用名、信用代码、状态、电话、邮箱、地址、来源 URL 和 AI 分均可查看。
- 超管：采用/驳回都有二次确认；两位管理员同时确认只能一位成功，另一位 409；注销企业不能采用。
- 超管：额度耗尽提示 429 并停止批量；缓存命中额度不增长；重新启动服务不清空额度。
- 超管：共用电话有黄色提示；新候选同 CRM 客户名/原文电话一致时禁止入池；历史数据保持不变。
- 销售/外贸：只看自己的线索；可看电话、来源与摘要；看不到反查按钮、管理员 Tab、额度、原始响应。
- 回归：登录、客户、报价、合同、回款、发货、上传附件、区域权限及小川只读查询正常。

真实供应商、真实登录页面及实际电话归属的人工验收尚未执行；测试假数据不代表供应商真实账户已联通。

## 6. N8N 运维下线

1. 在 N8N 管理界面停用本项目获客工作流；保留历史执行记录。
2. 在 FastGPT 停用本项目 lead 评分/写入应用；保留身份网关和只读应用。
3. 审阅 `docs/archive/n8n-lead-pipeline/sql/lead-writer-revoke.template.sql`，填入实际库名、账号和 host 后由管理员执行权限回收。该脚本不能删除 Lead 数据。
4. 从旧 MCP 容器/服务配置删除获客写入专用环境变量；保留 FULL_READ_ONLY/IDENTITY_POC 及人类身份配置。
5. 确认旧获客入口不可用、只读目录及查询仍正常。本次 Codex 未执行上述运维动作。

## 7. 回滚

代码优先回滚，保留新增表和字段。旧版本目录尚未覆盖，可按与上面相同、已核验的 PM2 启动方式恢复：

```bash
cd "$CRM_DIR"
PM2_APP="$PM2_APP" pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 list
curl -fsS https://dachuan.pro/api/health
```

作用：使用原目录、原 `.env` 和原运行产物恢复服务；上传目录继续使用原持久化位置。成功标准为旧版本 online 且业务验收正常，再执行 `pm2 save`。不得为了回滚删除新目录、旧目录或上传文件。若原服务并非 ecosystem 启动，必须用发布前保存的原启动配置恢复。

数据库通常不回滚，新结构兼容旧代码。必须回滚结构时，先导出 `lead_contact_lookups`、`lead_lookup_daily_quotas`、`leads` 和 `lead_hunt_candidates`（含新增列），确认文件可恢复后，再由管理员审阅执行迁移目录中的 rollback.sql。它会永久丢失本期核验证据和额度，不能自动还原之前已采用的 phone/email/assignedUserId；不要回灌全库旧备份覆盖发布后其他 CRM 业务数据。

本次不修改 Nginx 配置。N8N/FastGPT 获客链路保持停用，不因代码回滚自动重新启用。
