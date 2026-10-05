# Lead 写路径 N3 手动部署与回滚

## 1. 边界与停止条件

本方案只部署 `LEAD_WRITE_INTERNAL` 独立实例，并只允许审核通过的内部脚本访问 `lead_upsert`。不要把该地址配置到 FastGPT；FULL_READ_ONLY 的 FastGPT 目录继续保持身份工具加 24 个只读业务工具，共 25 项。

N3 不创建正式客户、不指派销售、不写合同、报价或跟进记录。本文件是手动 runbook，Codex 不代用户部署。执行前必须由用户现场确认真实路径、Compose 项目名、服务名、监听端口、数据库名、数据库账号 Host、Redis 地址、目标 commit、Artifact 和回滚镜像。下文 `/实际.../`、`<确认值>` 未替换完时必须停止。

以下任一条件不满足时标记 `BLOCKED_ENV`，不得继续：

- 没有独立 N3 Compose 文件、独立 `.env`、独立端口或上一版本回滚依据；
- Artifact 的 Run ID、`headSha`、内部 `SHA256SUMS` 与本次审核通过的 N3 公司级合并修正提交不一致，或仍指向批次 03 旧提交；
- 写账号权限超出 `leads SELECT,INSERT`、批准列的 column-level `UPDATE`、`lead_write_idempotencies SELECT,INSERT`、`lead_write_audits INSERT` 与 `users(id,role,territories,isActive)` 列级 SELECT；
- 服务断言 audience、公钥或 MCP API Key 与人类/只读路径发生复用；
- 现有 CRM、FULL_READ_ONLY MCP 或 Canary MCP 基线异常。

绝对禁止：`prisma migrate reset`、`db:reset`、`DROP DATABASE`、`TRUNCATE`、删除数据库审计记录、删除主项目或 uploads、将现有只读实例原地切换为写模式。

## 2. 现场变量与只读预检

先由用户把下列示例改为现场确认值；不要复制历史路径作为事实，也不要在聊天中填写密码：

```bash
N3_DIR='/实际独立N3目录'
N3_COMPOSE='/实际独立N3目录/docker-compose.lead-write-n3.yml'
N3_ENV='/实际独立N3目录/.env.lead-write-n3'
N3_PROJECT='实际独立Compose项目名'
N3_SERVICE='实际写服务名'
N3_HEALTH_URL='http://127.0.0.1:实际独立端口/api/mcp/health'
N3_ARTIFACT_DIR='/实际解压后的Artifact目录'
N3_BACKUP_DIR='/实际备份根目录/lead-write-n3-YYYYMMDD-HHMMSS'
```

这些变量只在当前 shell 生效。用途是减少重复输入；风险是填错路径后续命令会指向错误目标。逐项打印非敏感值复核：

```bash
printf '%s\n' "$N3_DIR" "$N3_COMPOSE" "$N3_ENV" "$N3_PROJECT" "$N3_SERVICE" "$N3_HEALTH_URL" "$N3_ARTIFACT_DIR" "$N3_BACKUP_DIR"
```

成功标准：八行均为已确认的绝对路径/名称/本机 URL，没有“实际”“YYYY”或空行。失败判断：任一值仍是占位符、指向 `/`、用户主目录或现有 FULL_READ_ONLY/Canary Compose；立即停止。

只读确认 Compose 文件、环境文件和服务名：

```bash
test -f "$N3_COMPOSE"
```

```bash
test -f "$N3_ENV"
```

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" config --quiet
```

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" config --services
```

用途：确认文件存在、Compose 能解析且 `N3_SERVICE` 确实属于独立 N3 项目。风险：只读，不启动容器；`config --quiet` 不输出展开后的敏感环境。成功标准：前三条退出码为 0，服务列表只包含预期写实例及经审核的依赖。失败判断：解析报错、服务名缺失或出现现有 FastGPT/CRM/只读 MCP 服务时停止。

检查现有基线，不做重启：

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" ps
```

```bash
pm2 list
```

```bash
sudo nginx -t
```

用途：记录 N3（若曾部署）、CRM PM2 和 Nginx 的部署前状态。风险：只读。成功标准：既有服务状态符合部署记录，`nginx -t` 成功。失败判断：现有服务退出/unhealthy、PM2 异常或 Nginx 校验失败；先处理原故障，不进入 N3。

## 3. 程序与数据库备份

先确认 `N3_BACKUP_DIR` 是新建的专用子目录，再创建权限受限的备份目录：

```bash
sudo install -d -m 700 "$N3_BACKUP_DIR"
```

若 N3 是已有实例，备份其完整 Compose 目录：

```bash
sudo cp -a "$N3_DIR/." "$N3_BACKUP_DIR/"
```

```bash
sudo test -s "$N3_BACKUP_DIR/$(basename "$N3_COMPOSE")"
```

```bash
sudo test -s "$N3_BACKUP_DIR/$(basename "$N3_ENV")"
```

用途：保留上一镜像标签、Compose 和受限环境文件。风险：备份目录包含 Secret，必须保持 `700` 且不得上传。成功标准：复制退出码为 0，两项文件非空。失败判断：空间不足、权限错误或文件缺失；停止。若是首次安装，没有旧 N3 目录可复制，应在部署记录写明 `FIRST_INSTALL`，回滚方式为停止新实例，不能伪造“已备份”。

数据库备份不使用需要数据库明文密码的命令。进入“宝塔面板 → 数据库 → 目标库 → 备份”，创建全库备份并确认文件大小非零、时间为本次操作、可下载。失败判断：备份为空或无法下载；停止。该步骤只备份，不执行 migration。

## 4. Artifact 身份核验与载入

进入已经从本次 GitHub Actions Run 下载并解压的轻量 MCP Artifact：

```bash
cd "$N3_ARTIFACT_DIR"
```

```bash
sha256sum -c SHA256SUMS
```

```bash
awk -F '\t' 'NR == 1 || $1 == "crm-mcp"' IMAGE_IDS.tsv
```

```bash
sha256sum images/dachuanpro-crm-erp-mcp-1.2.0-identity-acceptance.1.tar.gz
```

从身份清单读取非敏感的固定标签与两个归档摘要：

```bash
IFS=$'\t' read -r MCP_IMAGE_NAME MCP_IMAGE_TAG MCP_CONFIG_DIGEST MCP_OCI_MANIFEST_DIGEST _ _ < <(awk -F '\t' '$1 == "crm-mcp"' IMAGE_IDS.tsv)
```

```bash
test "$MCP_IMAGE_NAME" = "crm-mcp"
```

使用 Artifact 内置校验器交叉验证标签、`linux/amd64`、Config Digest、OCI Manifest Digest 及两者的引用关系：

```bash
node validate-prebuilt-image-archive.mjs images/dachuanpro-crm-erp-mcp-1.2.0-identity-acceptance.1.tar.gz "$MCP_IMAGE_TAG" "$MCP_CONFIG_DIGEST" "$MCP_OCI_MANIFEST_DIGEST"
```

用途：校验 Artifact 内部文件和 MCP 镜像归档，并记录内部 tar.gz SHA-256；这不是 GitHub Artifact ZIP 摘要。风险：只读。成功标准：`sha256sum -c` 全部 `OK`，`IMAGE_IDS.tsv` 只有表头和 `crm-mcp` 行，`MCP_IMAGE_NAME=crm-mcp`，内置校验器退出码为 0，记录的 Run ID/headSha 与批次 03 提交一致。失败判断：任一哈希、文件、标签、平台、摘要引用或 SHA 不一致；禁止载入。

载入已验证镜像，不在生产构建、不拉取远端镜像：

```bash
docker load -i images/dachuanpro-crm-erp-mcp-1.2.0-identity-acceptance.1.tar.gz
```

不同 Docker 镜像存储后端可能把载入后的 `.Id` 表示为 Config Digest 或 OCI Manifest Digest。读取实际值并只接受这两个已经交叉验证的摘要之一：

```bash
LOADED_IMAGE_ID="$(docker image inspect "$MCP_IMAGE_TAG" --format '{{.Id}}')"
```

```bash
case "$LOADED_IMAGE_ID" in "$MCP_CONFIG_DIGEST"|"$MCP_OCI_MANIFEST_DIGEST") printf '%s\n' "$LOADED_IMAGE_ID" ;; *) printf 'Unexpected loaded image ID: %s\n' "$LOADED_IMAGE_ID" >&2; false ;; esac
```

```bash
docker image inspect "$MCP_IMAGE_TAG" --format '{{json .RepoTags}}'
```

用途：把 CI 验收镜像载入本机并记录镜像身份。风险：只新增/复用本地镜像，不启动服务。成功标准：标签与 `IMAGE_IDS.tsv` 一致，载入后的 ID 匹配经归档校验器确认的 Config Digest 或 OCI Manifest Digest。失败判断：标签缺失，或 ID 不属于这两个固定摘要；停止。不得因为 Docker 后端显示形式不同而跳过归档内部的双摘要交叉验证。

## 5. phpMyAdmin migration 与最小授权

全程从“宝塔面板 → 数据库 → phpMyAdmin”进入，使用面板 SSO；不在服务器命令、聊天或文档中输入数据库管理员密码。

1. 在宝塔数据库备份完成后，选择已核实的 DachuanPro 数据库，依次确认已经应用 `prisma/migrations/20260814170000_add_lead_write_audits/migration.sql`，再导入 `prisma/migrations/20260818143000_add_lead_write_idempotencies/migration.sql`。
2. 在“结构”页面确认新增 `lead_write_idempotencies`，且现有非空 `Lead.idempotencyKey/payloadHash` 已回填为回执；不得修改 Customer、销售分配、合同或其他 CRM/ERP 表。
3. 在“用户账户”确认或创建 `dachuan_lead_writer`。Host 必须匹配 N3 数据库来源；不盲用 `%`。密码使用 phpMyAdmin 生成器，只写入受限 N3 Secret。
4. 不勾选全局/库级权限，不授予 `GRANT OPTION`。在 SQL 标签执行已替换数据库名和 Host 的 [授权模板](sql/lead-writer-grants.template.sql)。
5. `SHOW GRANTS` 的成功标准只有：`leads SELECT, INSERT`；批准合并列的 column-level `UPDATE`；`lead_write_idempotencies SELECT, INSERT`；`lead_write_audits INSERT`；以及自动路由所需的 `users(id,role,territories,isActive)` 列级 SELECT。出现用户密码/邮箱读取、任何 User 写权限、表级 UPDATE、`assignedUserId`/`companyName` 等受保护列 UPDATE、DELETE、DDL、其他表写权限或全局/库级权限即失败并停止。

本 migration 只回填幂等回执，不删除批次 03 可能已经产生的 `PENDING_REVIEW/duplicateOfLeadId` 历史行。启用新版本前应只读导出这类存量行供人工复核；历史数据清理或合并属于独立高风险任务，不得在本次部署中自动执行。新版本只保证后续严格同公司命中不再新增重复 Lead。

普通代码回滚不执行 `rollback.sql`，默认保留审计证据。只有用户再次明确授权、审计已导出且确认永久丢失风险后，才可考虑删除表。

## 6. N3 独立环境配置

`.env`/Secret 至少配置下列项，文件权限应为 `600`。不要打印完整文件：

- `MCP_TOOL_MODE=LEAD_WRITE_INTERNAL`
- `MCP_COMMAND_TOOL_ALLOWLIST=lead_upsert`
- `MCP_COMMAND_PRINCIPAL_ALLOWLIST=<审核确定的稳定服务 ID>`
- `MCP_COMMAND_API_KEYS_JSON`：写实例独立服务 Key 哈希，不含人类字段
- `MCP_API_KEYS_JSON`：只读实例 Key 的哈希清单，仅用于启动时证明没有复用，不含明文 Key
- `MCP_COMMAND_DATABASE_URL`：`dachuan_lead_writer` 连接
- `MCP_AUDIT_DATABASE_URL`：既有协议审计账号连接，必须与写账号不同
- `MCP_AUDIT_USER_ID`：既有协议审计占位用户，不代表服务主体
- `MCP_ALLOWED_HOSTS`、`MCP_ALLOWED_ORIGINS`：只允许审核确定的内部来源
- `LEAD_WRITER_AUTH_ISSUER`
- `LEAD_WRITER_AUTH_AUDIENCE` 与 `AGENT_AUTH_AUDIENCE`：必须不同
- `LEAD_WRITER_AUTH_KEYS_JSON`：服务公钥清单，只含公钥
- `AGENT_AUTH_PUBLIC_KEYS_JSON`：人类断言公钥清单，仅用于启动时证明服务密钥没有复用，也不得含私钥
- `LEAD_WRITER_AUTH_REDIS_URL`、独立 `LEAD_WRITER_AUTH_REDIS_PREFIX`
- `LEAD_WRITER_AUTH_RATE_LIMIT_PER_MINUTE`

内部签发端单独保存 Ed25519 私钥，签发 `principalType=SERVICE`、稳定 principalId、`scope=["lead:create"]` 的短期断言。断言、私钥、明文 API Key、数据库连接和完整请求头不得写入日志。

只检查权限和两个非敏感固定值：

```bash
stat -c '%a %U:%G %n' "$N3_ENV"
```

```bash
grep -E '^(MCP_TOOL_MODE=LEAD_WRITE_INTERNAL|MCP_COMMAND_TOOL_ALLOWLIST=lead_upsert)$' "$N3_ENV"
```

成功标准：权限为 `600`，两行固定配置均命中。失败判断：权限更宽、模式或 allowlist 不一致；停止。禁止 `cat`、`env` 或 `docker compose config` 输出完整 Secret。

## 7. 只启动独立写实例

先列出 Compose 将使用的镜像，确认只指向上一步已验证标签：

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" config --images
```

成功标准：写服务镜像为 `dachuanpro-crm-erp-mcp:1.2.0-identity-acceptance.1`，没有 `latest`。失败判断：标签不符、需要 build 或会拉取未知镜像；停止。

只重建已确认的写服务，不启动依赖、不影响现有 Canary：

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" up -d --no-deps --pull never "$N3_SERVICE"
```

用途：启动 N3 写实例。风险：对生产数据库开放受限 INSERT 和指定 Lead 列 UPDATE；已通过独立服务身份、allowlist 和 column-level DB GRANT 双锁限制。成功标准：命令退出码为 0且没有 build/pull。失败判断：容器退出、镜像不存在、配置守卫报错或数据库/Redis 连接失败；停止验收并进入回滚。

## 8. 健康与业务闭环验收

检查 Compose 状态和健康接口：

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" ps "$N3_SERVICE"
```

```bash
curl -fSs "$N3_HEALTH_URL"
```

成功标准：写服务 `running/healthy`，健康接口返回 `status=ok`。失败判断：退出、unhealthy、超时或非 2xx。失败时只读取该写服务最近日志，不输出环境：

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" logs --tail 100 "$N3_SERVICE"
```

`running`、`PM2 online` 或健康 200 只证明存活，不能替代以下内部脚本业务闭环：

1. MCP `tools/list` 只能看到 `lead_upsert`。
2. 写入一条带明显 N3 标识的非真实测试线索；记录 `idempotencyKey`，不得使用 `X-Dachuan-Request-Id` 代替。
3. 同键同哈希再次调用，必须返回同一 Lead 且 `replay=true`。
4. 同键改变业务 payload 并重算 hash，必须返回 `IDEMPOTENCY_CONFLICT`。
5. 使用新 idempotencyKey 再次写入严格规范化后相同的 companyName，必须返回同一 Lead；已有非空联系人不变、关键词累积、评分画像更新，回执表保留两个 key。
6. 对合并后的第二个 key 重放必须 `replay=true`，改变 payload 必须 `IDEMPOTENCY_CONFLICT`。
7. 在 phpMyAdmin 只读查询 `lead_write_audits`，同一 key 必须依次存在 `CREATED`、`REPLAY`、`CONFLICT`，principalType 为 SERVICE、principalId 正确。
8. 使用人类 SUPER_ADMIN 断言调用必须被拒；服务身份尝试客户/合同等工具必须得到未知/未启用工具错误。
9. 通过隔离验收确认写账号不能 INSERT `lead_feedback_events`/客户/合同，不能 UPDATE `companyName`、`assignedUserId` 等受保护 Lead 列，也不能 DELETE Lead。
10. 复查 FULL_READ_ONLY/FastGPT 目录仍为 25 项，既有 24 个业务只读工具可用。

任一项失败即 N3 不通过，写实例保持内部隔离并立即回滚。不要为“通过测试”删除或修改审计证据。

## 9. 非破坏性回滚

先停止且只停止独立写服务：

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" stop "$N3_SERVICE"
```

用途：立即关闭新写入口。风险：仅影响 N3 写实例。成功标准：`ps` 显示该服务 stopped/exited，现有 FULL_READ_ONLY、Canary、CRM 不变。失败判断：命令指向其他 Compose 项目或服务；不要继续，先核对变量。

在内部签发端撤销本次 SERVICE JTI，并停用/轮换写 API Key；不要在命令行回显断言或 Key。然后进入 phpMyAdmin 执行已替换数据库名与 Host 的 [权限回收模板](sql/lead-writer-revoke.template.sql)。成功标准：`SHOW GRANTS` 不再包含 Lead 写入、批准列 UPDATE、幂等回执或写审计授权；失败判断：仍有相关权限时保持写入口关闭。

若部署前已有 N3 版本，从受限备份恢复 Compose 和 `.env`：

```bash
sudo cp -a "$N3_BACKUP_DIR/." "$N3_DIR/"
```

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" config --quiet
```

```bash
docker compose -p "$N3_PROJECT" --env-file "$N3_ENV" -f "$N3_COMPOSE" up -d --no-deps --pull never "$N3_SERVICE"
```

用途：恢复部署前镜像标签、环境和服务。风险：会覆盖当前 N3 配置，但不触碰其他项目；仅在 `N3_BACKUP_DIR` 已验证时执行。成功标准：上一镜像 Image ID 恢复、健康检查通过。失败判断：备份缺失/为空或服务仍异常；保持写入口关闭并人工处理。首次安装只需保持新服务 stopped，不删除目录或镜像。

默认保留已经写入的 Lead 和全部 `lead_write_audits`，交由人工复核。数据库恢复仅用于灾难场景，由用户另行授权后通过宝塔备份恢复；普通代码回滚不导入旧库、不删除表、不删除测试记录。

开发分支代码回退使用单独 revert，不改写历史：

```bash
git status --short
```

```bash
git revert <本次N3公司级合并修正提交SHA>
```

```bash
git push origin codex/mcp-filter-argument-hardening
```

用途：生成可审计的反向提交并触发新构建。风险：只能对本次 N3 公司级合并修正的精确提交执行；工作区不干净或 SHA 不明确时停止。成功标准：产生新的 revert commit，CI 对该 commit 通过。失败判断：冲突或误选提交；不要 reset/force push，保持现场并交由代码审查。
