# V1：MySQL 5.7 迁移往返

状态：**通过（仅本地一次性测试库）**。基准 `594ffb8e`，日期 2026-11-09（America/Los_Angeles）。

## 环境与隔离

Docker Client/Engine 29.6.1，Docker Desktop 4.82.0，Compose v5.3.0，引擎运行。镜像 mysql:5.7.44 拉取成功，digest 为 `sha256:4bc6bc963e6d8443453676cae56536f4b8156d78bae03c0145cbe47c2aad73bb`。

容器只绑定 127.0.0.1，库名 crm_v1_test；无主机目录挂载。随机密码仅在仓库外临时私有状态和子进程环境中使用，没有写入证据；测试结束后已删除容器、匿名卷与临时目录。没有访问正式或远程数据库。

| 数据库设置 | 实测 |
| --- | --- |
| version | 5.7.44 |
| sql_mode | ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION |
| character_set_server | utf8mb4 |
| collation_server | utf8mb4_unicode_ci |

每次 Prisma 调用前，执行程序均校验 DATABASE_URL 的主机为 127.0.0.1、端口为本任务容器映射端口、数据库名为 crm_v1_test。迁移操作只有 migrate deploy、migrate status 和明确要求核实的 migrate resolve --rolled-back；没有运行 migrate dev、migrate reset 或 db push。所有 schema/migrations 副本和上传目录位于仓库外。

## 基线与 A / B / C

基线副本排除 `20261107010000_add_lead_contact_verification`，36 条迁移 deploy 全部成功；基线 status 为同步。完整副本 status 返回 1，且仅此目标迁移待应用，这是预期的待应用状态。

| 检查 | 结果 |
| --- | --- |
| A：首次 deploy | 通过；目标迁移应用成功 |
| 新列 | leads 的 contactStatus、contactStatusUpdatedAt、phoneSource、phoneEvidence、phoneVerifiedAt、tycCompanyId、creditCode；候选的 contactName、phoneSource、phoneEvidence、dedupKey、statusReason，共 12 列全部存在 |
| 新索引 | leads_contactStatus_idx、leads_creditCode_idx、leads_phone_idx、lead_hunt_candidates_dedupKey_idx，共 4 个全部存在 |
| 新表及其列/索引 | lead_contact_lookups、lead_lookup_daily_quotas 均为 InnoDB、utf8mb4_unicode_ci；完整列类型、可空性、默认值及全部索引见 A/C information_schema 日志 |
| 新外键 | leadId→leads.id、requestedById→users.id、confirmedById→users.id；三个均 DELETE RESTRICT / UPDATE CASCADE |
| 外键删除保护 | 插入引用测试线索的核验记录后，删除线索被 MySQL 1451 拒绝，命中 leadId 外键 |
| B：执行原 rollback.sql | 通过；上述新增内容全部消失；四张原有表的有序列、索引、外键及表属性快照与基线完全一致 |
| 原有数据 | 测试用户、线索、任务、候选的选定原有字段，在回滚及重部署后均与迁移前完全一致 |
| C：再次 deploy | 通过；结构快照与 A 完全一致；最终 migrate status 为同步 |
| 新增核验数据 | 回滚时随新表删除；C 后该表为 0 行，不会自动恢复核验证据，与 rollback.sql 警告一致 |

证据：[环境](evidence/environment.txt)、[A](evidence/v1-structure-A.txt)、[B](evidence/v1-structure-B.txt)、[C](evidence/v1-structure-C.txt)、[外键](evidence/v1-foreign-key-restrict.txt)、[汇总](evidence/v1-summary.json)。

## 迁移历史实际行为与 deployment.md 第 7 节补充建议

1. rollback.sql 执行后，_prisma_migrations 中目标迁移仍 finished=1、rolled_back=0、applied_steps_count=1。
2. 直接 migrate deploy 返回 0，但提示 No pending migrations to apply；结构仍处于 B，不会重建。这不是重部署成功的结构证据。
3. `prisma migrate resolve --rolled-back 20261107010000_add_lead_contact_verification` 返回 1 / P3012：该条成功迁移并非 failed 状态，不能这样标记回滚。
4. **仅在本次一次性测试库**：先验证 B 与基线完全一致，保存目标历史行的 id、checksum、状态和时间；再按精确 migration_name、原 SQL 的 SHA-256、finished_at 非空、rolled_back_at 为空及 applied_steps_count=1 筛选，删除这一条历史记录（实际 1 行）。之后 migrate deploy 才实际重新执行目标迁移，C 与 A 一致。
5. 正式流程建议：在第 7 节明确“结构回滚不等于迁移历史回滚”；若已成功的迁移需重新部署，先备份、核实全部 DDL 已完整回滚，再**单独审阅迁移历史协调方案或新的正向迁移**。不能自动套用 resolve --rolled-back，也不能将本次测试库删除历史行的实验直接复制到正式库。本轮没有修改 deployment.md。

详见 [回滚后历史](evidence/v1-history-after-rollback.txt)、[直接重部署](evidence/v1-redeploy-with-unchanged-history.txt)、[resolve 实测](evidence/v1-resolve-rolled-back.txt)、[精确历史处理](evidence/v1-test-history-reconcile.txt)。

V1 完成后容器用于 V2；进入 V2 前仅删除 V1 的四条指定测试实体，避免 seed 清理用户时被测试任务外键阻止。A/B/C 中原有数据保持验证已先完成。该清理没有用于掩盖迁移问题。


## deployment.md 第 7 节修订建议

**仅为建议，待复审；本轮不修改 deployment.md，不在正式库执行以下操作。**

结构回滚与迁移记录回滚必须分开处理。成功应用过的本迁移执行 rollback.sql 后，`_prisma_migrations` 中成功记录仍在；直接 `migrate deploy` 会提示没有待执行迁移，不会重建表结构。实测 `prisma migrate resolve --rolled-back 20261107010000_add_lead_contact_verification` 返回 **P3012**（该迁移并非 failed），不能把它作为本场景的回滚步骤。

测试库实测可用的方法是：完整备份目标历史行，核实结构已回到基线，然后精确删除且只删除该行；再 deploy，才能真正重建 C。本建议涉及迁移历史写操作，必须经复审和管理员确认后，在维护窗口执行；不要自动化套用。默认仍优先仅回滚代码、保留兼容结构。

### 1. 备份并停止相关写入

先按 deployment.md 第 2 节完成项目、数据库和 uploads 备份，核对 PM2 服务名、Nginx、环境变量及上传目录；备份必须在隔离库验证可恢复。导出核验表、额度表及 leads／候选新增列；原 rollback.sql 会永久丢失核验和额度数据，不会撤销已回填的电话或分配。

确认已切回旧代码、停止新功能相关写入；若维护方式、原启动配置或实际路径不明确，停止执行，不猜测路径。下列 Bash 变量沿用已审核部署流程中的 `RELEASE_DIR`、`BACKUP_DIR`、`MYSQL_BACKUP_CONFIG`、`DB_NAME`；不回显连接密码。

### 2. 完成结构回滚并验证基线

由管理员复核后单独执行原迁移目录中的 rollback.sql。通过 information_schema 对照迁移前快照：新增 12 列、4 索引、2 张表及其外键均已撤销，原列、索引、约束、数据保留。DDL 部分失败、结构不完全一致、仍有新功能写入或备份不可恢复时停止，不能删除迁移记录。

### 3. 核对并备份唯一的成功迁移行

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

### 4. 交互事务中精确删除一行

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

### 5. 再次部署与验证

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

### 6. 历史协调自身的恢复

提交前出错可直接 ROLLBACK。删除提交后但尚未重新运行 migration 时，若决定撤销此次协调，先核对尚无该 id／新迁移记录，再由管理员审阅恢复第 3 步的精确历史行备份；这只恢复历史元数据，不恢复表结构或核验数据。若已重新执行迁移或出现部分 DDL，不得直接回灌旧历史行，须同时复核实际结构与新历史记录后制定恢复方案。禁止用旧全库备份覆盖发布后其他 CRM 数据。

本次 V2 重建再次采用了测试库限定的精确历史协调：先备份目标行，再删除满足名称、checksum 和成功状态的唯一行，记录实际删除 1 行，C deploy 和 status 均通过。只记录“已重建”，不替代原 V1 A/B/C 报告。
