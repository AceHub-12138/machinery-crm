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

### 7.1 默认只回滚代码

代码优先回滚，保留新增表和字段。旧版本目录尚未覆盖，可按与上面相同、已核验的 PM2 启动方式恢复：

```bash
cd "$CRM_DIR"
PM2_APP="$PM2_APP" pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 list
curl -fsS https://dachuan.pro/api/health
```

作用：使用原目录、原 `.env` 和原运行产物恢复服务；上传目录继续使用原持久化位置。成功标准为旧版本 online 且业务验收正常，再执行 `pm2 save`。不得为了回滚删除新目录、旧目录或上传文件。若原服务并非 ecosystem 启动，必须用发布前保存的原启动配置恢复。

本次不修改 Nginx 配置。N8N/FastGPT 获客链路保持停用，不因代码回滚自动重新启用。

### 7.2 结构回滚（管理员审批后单独执行）

结构回滚与迁移记录回滚必须分开处理。成功应用过的本迁移执行 rollback.sql 后，`_prisma_migrations` 中成功记录仍在；直接 `migrate deploy` 会提示没有待执行迁移，不会重建表结构。实测 `prisma migrate resolve --rolled-back 20261107010000_add_lead_contact_verification` 返回 **P3012**（该迁移并非 failed），不能把它作为本场景的回滚步骤。

测试库实测可用的方法是：完整备份目标历史行，核实结构已回到基线，然后精确删除且只删除该行；再 deploy，才能真正重建 C。本建议涉及迁移历史写操作，必须经复审和管理员确认后，在维护窗口执行；不要自动化套用。默认仍优先仅回滚代码、保留兼容结构。

#### 1. 备份并停止相关写入

先按 deployment.md 第 2 节完成项目、数据库和 uploads 备份，核对 PM2 服务名、Nginx、环境变量及上传目录；备份必须在隔离库验证可恢复。导出核验表、额度表及 leads／候选新增列；原 rollback.sql 会永久丢失核验和额度数据，不会撤销已回填的电话或分配。

确认已切回旧代码、停止新功能相关写入；若维护方式、原启动配置或实际路径不明确，停止执行，不猜测路径。下列 Bash 变量沿用已审核部署流程中的 `RELEASE_DIR`、`BACKUP_DIR`、`MYSQL_BACKUP_CONFIG`、`DB_NAME`；不回显连接密码。

#### 2. 完成结构回滚并验证基线

由管理员复核后单独执行原迁移目录中的 rollback.sql。通过 information_schema 对照迁移前快照：新增 12 列、4 索引、2 张表及其外键均已撤销，原列、索引、约束、数据保留。DDL 部分失败、结构不完全一致、仍有新功能写入或备份不可恢复时停止，不能删除迁移记录。

#### 3. 核对并备份唯一的成功迁移行

```bash
MIGRATION_NAME=20261107010000_add_lead_contact_verification
MIGRATION_FILE="$RELEASE_DIR/prisma/migrations/$MIGRATION_NAME/migration.sql"
test -f "$MIGRATION_FILE"
MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d ' ' -f 1)
test "${#MIGRATION_SHA256}" -eq 64
```

作用：计算原始 migration.sql 的 SHA-256。必须与实际已应用的同版本文件和历史行 checksum 一致；若文件经过换行改写或内容变化，停止，不能改 checksum 迁就现状。

```bash
mysql --defaults-extra-file="$MYSQL_BACKUP_CONFIG" "$DB_NAME" <<SQL
SELECT id,migration_name,checksum,started_at,finished_at,rolled_back_at,applied_steps_count
FROM _prisma_migrations
WHERE migration_name='$MIGRATION_NAME';
SQL
```

作用：只读确认该名称只有一条目标成功记录，并记录精确 id；要求 checksum 匹配、finished_at 非空、rolled_back_at 为空、applied_steps_count=1。如有重复、失败记录或状态不符，停止，单独审查。

```bash
read -r -p '已核对的唯一成功迁移行 id：' MIGRATION_ROW_ID
[[ "$MIGRATION_ROW_ID" =~ ^[a-fA-F0-9-]{36}$ ]]
[[ "$MIGRATION_SHA256" =~ ^[a-fA-F0-9]{64}$ ]]
HISTORY_BACKUP="$BACKUP_DIR/lead-contact-migration-history.sql"
test ! -e "$HISTORY_BACKUP"
mysqldump --defaults-extra-file="$MYSQL_BACKUP_CONFIG" --no-create-info --skip-add-drop-table --skip-triggers --complete-insert --default-character-set=utf8mb4 --where="id='$MIGRATION_ROW_ID' AND migration_name='$MIGRATION_NAME' AND checksum='$MIGRATION_SHA256' AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count=1" "$DB_NAME" _prisma_migrations > "$HISTORY_BACKUP"
test -s "$HISTORY_BACKUP"
```

作用：将该行全部字段导出到新的专用文件。文件非空不足以证明有目标行；管理员还须核对其中恰好有该 id 的一行完整 INSERT，并在隔离库验证可恢复，再进入下一步。备份可能含迁移诊断，不公开上传。任何命令失败均停止。

#### 4. 交互事务中精确删除一行

```bash
mysql --defaults-extra-file="$MYSQL_BACKUP_CONFIG" "$DB_NAME"
```

作用：进入已确认数据库的交互会话。下面的 `<精确 id>` 和 `<核对后的 checksum>` 必须手工替换为上一步已核对值；不要原样执行占位符。不要把 COMMIT 和删除拼成一行。

```sql
START TRANSACTION;
SELECT id,migration_name,checksum,finished_at,rolled_back_at,applied_steps_count
FROM _prisma_migrations
WHERE id='<精确 id>'
  AND migration_name='20261107010000_add_lead_contact_verification'
  AND checksum='<核对后的 checksum>'
  AND finished_at IS NOT NULL
  AND rolled_back_at IS NULL
  AND applied_steps_count=1
FOR UPDATE;
```

仅当锁定结果恰好一行、与完整备份一致时，再执行：

```sql
DELETE FROM _prisma_migrations
WHERE id='<精确 id>'
  AND migration_name='20261107010000_add_lead_contact_verification'
  AND checksum='<核对后的 checksum>'
  AND finished_at IS NOT NULL
  AND rolled_back_at IS NULL
  AND applied_steps_count=1;
SELECT ROW_COUNT() AS deleted_history_rows;
```

实际删除数必须恰好为 1，才单独执行：

```sql
COMMIT;
```

若不是 1，或核对发现任何不符，执行以下语句并停止排查：

```sql
ROLLBACK;
```

禁止按迁移名称批量删除、清空迁移表、修改 checksum，或删除业务表数据。这里只处理已完整回滚那条成功迁移记录。

#### 5. 再次部署与验证

```bash
cd "$RELEASE_DIR"
pnpm exec prisma migrate status
```

作用：应只显示目标迁移待应用；有其他待应用、失败或历史不一致时停止。随后：

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status
```

作用：真正重新应用该迁移并检查历史同步。再次核对 information_schema，要求 C 与首次 A 完全一致、迁移记录成功、原 CRM 数据保持；仅有 deploy 退出 0 不算通过。任一步失败，保留旧代码和维护状态，保存日志并复审，不使用 reset、db push 或批量 resolve。

#### 6. 历史协调自身的恢复

提交前出错可直接 ROLLBACK。删除提交后但尚未重新运行 migration 时，若决定撤销此次协调，先核对尚无该 id／新迁移记录，再由管理员审阅恢复第 3 步的精确历史行备份；这只恢复历史元数据，不恢复表结构或核验数据。若已重新执行迁移或出现部分 DDL，不得直接回灌旧历史行，须同时复核实际结构与新历史记录后制定恢复方案。禁止用旧全库备份覆盖发布后其他 CRM 数据。
