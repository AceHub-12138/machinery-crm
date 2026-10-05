# N4：N8N → FastGPT Lead Score/Write Agent → Lead MCP 手动部署与回滚

## 1. 范围、前置条件与停止线

N4 只把已部署的 N3 写实例接入 N8N 和 FastGPT；N4 本身不执行 migration。开始前必须确认 N3 已应用公司级合并所需的 `lead_write_idempotencies` additive migration 和 column-level UPDATE 最小授权。N3 仍只发布 `lead_upsert`；FULL_READ_ONLY 实例仍是 25 项目录。执行前先完成 [N3 手动部署与回滚](./LEAD_WRITE_N3_DEPLOYMENT.md) 并记录其健康状态、回滚镜像和 `SHOW GRANTS` 证据。

部署采用“两把锁”：

1. FastGPT 只给明确列入 `LEAD_SERVICE_ASSERTION_APP_IDS` 的 Lead Write Agent 签发 SERVICE 断言；Lead Score Agent 不在 allowlist 且没有 MCP 工具。断言只有 `lead:create`，且 audience、密钥、Redis 命名空间、限流均不与人类断言共用。
2. N3 只接受稳定 `principalId` 白名单、独立 MCP 服务 Key 和最小数据库写账号。写账号只有 `leads SELECT,INSERT`、批准合并列的 column-level `UPDATE`、`lead_write_idempotencies SELECT,INSERT`、`lead_write_audits INSERT` 与自动路由所需的 `users(id,role,territories,isActive)` 列级 SELECT；不得获得 User 写权限、表级 UPDATE、销售分配字段 UPDATE、DELETE 或 DDL。

以下任一项不满足时停止：批次 04 CI 未全绿；Artifact 的 commit/Run ID/SHA256 无法对应；N3 健康或 1 项目录异常；FastGPT 私钥无法使用受限 Secret 配置；N8N 凭据必须写进节点、提示词或普通变量；现有 CRM、只读 MCP 或上传目录异常。

## 2. 部署前备份与现场核对

在宝塔面板中备份 FastGPT 与 N8N 当前配置目录或容器编排文件，记录当前镜像标签、工作流版本和服务状态。数据库虽然没有变更，仍在“宝塔面板 → 数据库”创建一次可下载且大小非零的全库备份；本批不导入 SQL。

通过面板核对：

- FastGPT、N8N、N3 的真实服务名、内部地址和回滚版本；
- N3 MCP 地址只在内部网络可达，目录只有 `lead_upsert`；
- phpMyAdmin 中 `leads`、`lead_write_audits` 已存在；
- N3 写账号没有表级 UPDATE、受保护 Lead 列 UPDATE、`DELETE`、`ALTER`、`DROP`、`CREATE`；
- FastGPT 的 Lead SERVICE audience 与 N3 完全一致，但与人类断言 audience 不同；两套公钥和 Redis 前缀也不同。
- `pm2 list` 中现有 CRM 服务状态与部署前记录一致；若 FastGPT/N8N 使用容器，则记录其容器状态而不是误改 PM2。
- Nginx 当前配置校验通过，并确认本批不覆盖现有站点、证书或反向代理；N8N Webhook 不直接匿名暴露公网。
- 逐项导出并核对非敏感环境变量名，确认不会用批次 04 配置覆盖现有 CRM、FULL_READ_ONLY 或 Canary 环境文件。
- uploads 的真实挂载路径仍指向原目录且已有独立备份；本批不复制、不清空、不重新挂载 uploads。

不要在聊天、工单、截图、命令历史或本文中填写真实密码、API Key、私钥、JWT 或完整环境文件。

### 命令边界清单

Secret、工作流导入和版本选择按任务要求只在宝塔/FastGPT/N8N GUI 完成。下面命令只用于已经确认真实服务名和路径后的备份、配置预检、单服务重建、健康检查与回滚；尖括号占位符未全部替换前禁止执行，任何命令都不得追加密码、Key、JWT 或私钥参数。

先在本地代码仓库只读核对待部署提交：

```text
git rev-parse HEAD
git show --stat --oneline <批次04提交SHA>
```

成功标准是两条命令显示同一审核通过的 SHA；否则停止。

在服务器上先确认 `<N4_BACKUP_DIR>` 是专用的新目录，且 `<FASTGPT_CONFIG_DIR>`、`<N8N_CONFIG_DIR>` 是已核实的配置目录，不是 uploads、数据库数据目录或工作区根目录。逐条执行：

```text
mkdir -p <N4_BACKUP_DIR>
tar -czf <N4_BACKUP_DIR>/fastgpt-config-before-n4.tar.gz -C <FASTGPT_CONFIG_PARENT> <FASTGPT_CONFIG_DIR_NAME>
tar -czf <N4_BACKUP_DIR>/n8n-config-before-n4.tar.gz -C <N8N_CONFIG_PARENT> <N8N_CONFIG_DIR_NAME>
test -s <N4_BACKUP_DIR>/fastgpt-config-before-n4.tar.gz
test -s <N4_BACKUP_DIR>/n8n-config-before-n4.tar.gz
```

用途是只读打包配置并验证备份非空；风险是路径填错会备份错误内容，因此每条命令单独执行。成功标准是两个 `test -s` 都返回 0，失败立即停止。本批数据库备份仍只走宝塔 GUI，不把数据库密码放进命令历史。

完成 GUI Secret、镜像和工作流配置后，先预检 Compose，再只重建目标服务：

```text
docker compose -p <FASTGPT_PROJECT> -f <FASTGPT_COMPOSE_FILE> config --quiet
docker compose -p <FASTGPT_PROJECT> -f <FASTGPT_COMPOSE_FILE> up -d --no-deps --force-recreate <FASTGPT_SERVICE>
docker compose -p <N8N_PROJECT> -f <N8N_COMPOSE_FILE> config --quiet
docker compose -p <N8N_PROJECT> -f <N8N_COMPOSE_FILE> up -d --no-deps --force-recreate <N8N_SERVICE>
```

用途是验证编排语法并只重建 FastGPT/N8N 目标服务；风险是服务名或项目名填错会操作错误容器，所以必须与部署前记录逐字一致。任一 `config --quiet` 非零都禁止继续。重建后逐条检查：

```text
docker compose -p <FASTGPT_PROJECT> -f <FASTGPT_COMPOSE_FILE> ps <FASTGPT_SERVICE>
docker compose -p <N8N_PROJECT> -f <N8N_COMPOSE_FILE> ps <N8N_SERVICE>
curl --fail --silent --show-error <FASTGPT_LOOPBACK_HEALTH_URL>
curl --fail --silent --show-error <N8N_LOOPBACK_HEALTH_URL>
```

成功标准是两个目标服务均为运行/健康状态、两个回环健康地址返回成功，且后续第 6 节业务验收全部通过。失败判断包括服务退出、健康检查非 2xx、目录数量异常、写入/审计不符或敏感信息扫描命中。

失败时先在 GUI 恢复旧镜像和旧配置备份，然后仅重建原目标服务：

```text
docker compose -p <FASTGPT_PROJECT> -f <FASTGPT_COMPOSE_FILE> config --quiet
docker compose -p <FASTGPT_PROJECT> -f <FASTGPT_COMPOSE_FILE> up -d --no-deps --force-recreate <FASTGPT_SERVICE>
docker compose -p <N8N_PROJECT> -f <N8N_COMPOSE_FILE> config --quiet
docker compose -p <N8N_PROJECT> -f <N8N_COMPOSE_FILE> up -d --no-deps --force-recreate <N8N_SERVICE>
git revert <批次04提交SHA>
```

回滚成功标准是旧版本健康、N8N 触发器关闭、N3/FULL_READ_ONLY 目录保持 1/25 项且没有删除 Lead 或审计。代码回滚只使用 `git revert`，不得 force push。

绝对禁止执行 `git reset --hard`、`git push --force`、`prisma migrate reset`、`docker system prune`、数据库 `DROP/TRUNCATE/DELETE` 或绕过 N3 的人工业务 UPDATE，也不得对未核实的路径执行递归删除或用命令行明文传入 Secret。FastGPT/N8N 的实际服务名、Compose 路径和健康地址必须先在现场确认；本 runbook 不猜测这些值。

## 3. FastGPT 补丁与 Secret 图形配置

只对 README 指定的 FastGPT v4.15.1 精确提交应用 `deploy/fastgpt/v4.15.1/0001-dachuan-trusted-mcp-identity.patch`，并使用通过 CI 的固定镜像。原 `x-dachuan-user-assertion` 人类路径保持不变。

在宝塔面板的容器/编排 Secret 或受限文件挂载界面完成配置：

- 使用面板生成器生成独立 Ed25519 服务密钥；私钥只挂载给 FastGPT，权限只允许容器运行用户读取；
- N3 只配置对应公钥，N8N、MCP 镜像、工作流输入和普通环境展示页都不得得到私钥；
- TTL 设为 300～900 秒，推荐 300 秒；
- `principalId` 使用稳定服务标识；scope 固定且仅为 `lead:create`；
- Redis 前缀和每分钟限流使用 Lead SERVICE 专用值；
- 第一次导入两个工作流后分别记录应用 ID，只把 Lead Write Agent 的 ID 单独加入应用 allowlist；不要加入 Score Agent，也不要使用全局通配。

保存前由两人分别核对“私钥只在 FastGPT”和“四隔离”配置。保存后只重启/重建 FastGPT 目标服务，不动 CRM、FULL_READ_ONLY MCP 或 N3 数据库。

## 4. 导入并配置 FastGPT Lead Score/Write Agent

在 FastGPT 管理面板分别导入：

1. `deploy/fastgpt/v4.15.1/workflows/lead-score-agent-v1.json`：在评分节点选择当前批准的模型。首发可选 DeepSeek，但工作流不绑定厂商；后续可换成其他支持严格 JSON 的模型。
2. 在 FastGPT 的模型供应商凭据/Secret 面板绑定模型 Key。Key 不进入 N8N、Prompt、聊天变量或导出的工作流 JSON。
3. 把 Score Agent 的 `sourceModelVersion` 改成实际供应商、模型和版本；`extractorVersion` 保持 `lead-score-v1`。换模型时必须创建新评分版本并更新 `sourceModelVersion`。
4. `deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json`：新建 N3 MCP 工具集，只配置内部 URL 和 FastGPT Secret 中的独立服务 Key；不得静态填写任何 `X-Dachuan-*` 头。
5. 确认工具发现只有 `lead_upsert`，再把 Write Agent 的工具节点重新绑定到它。Write Agent 不包含模型节点，Score Agent 不包含工具节点。
6. 为两个应用分别创建 app-bound API Key，并只保存在 N8N 凭据管理器；两把 Key 不共用。只把 Write Agent 应用 ID 加入 `LEAD_SERVICE_ASSERTION_APP_IDS`。
7. 两个应用均保存为未开放的新版本，先手工验证 Score Agent 严格输出和 Write Agent 1～20 条整页校验，再允许 N8N 调用。

Score Agent 输出必须符合 [Lead 评分画像 Prompt v1](./LEAD_SCORING_PROMPT_V1.md)。N8N 收齐当前页全部锁定评分后才调用一次 Write Agent；任一评分 JSON 非法、`aiScore` 不是 0～100 整数或 profile 缺字段时，当前页必须在调用 MCP 前整体失败。

## 5. 导入 N8N Lead Staging

在 N8N 面板导入 `n8n/workflows/lead-staging-v1.json`，保持工作流停用，完成以下 GUI 配置：

1. 把 FastGPT URL 占位符换成已核对的内部/受控地址。
2. 为 Webhook 入口新建独立 Header Auth 凭据并绑定到入口节点；它不能与 FastGPT API Key 共用。上游清洗流程只从 N8N 凭据管理器引用它，匿名请求必须被拒绝。
3. 在 Score HTTP 与 Write HTTP 节点分别选择对应应用的专属 Header Auth；不得共用凭据，也不得把 Key 直接写进 HTTP 节点。
4. 若其他 N8N 流程会直接使用模型供应商，模型 Key 也只能存入 N8N 凭据管理器；本 Lead Staging 流程本身只调用 FastGPT，不需要接收或转发模型 Key。
5. 保持每页最多 20 条。Score HTTP 可重试，因为没有写副作用；当前页评分全部通过后生成不可变 `lockedPageJson`，Write HTTP 最多重试 3 次且每次复用这份完全相同的正文和原 `idempotencyKey`。不得重新评分后重试写入，也不得用 `X-Dachuan-Request-Id` 替代幂等键。
6. 保持成功/失败执行数据与中间进度持久化关闭，避免 N8N 数据库长期保存联系人正文；需要排错时只在受控窗口临时开启并按公司留存策略清理。
7. 运行一次手工测试，确认匿名 Webhook 被拒绝，合法请求返回 `leadId`、`dedupStatus`、`duplicateOfLeadId`、`replay` 和追踪 requestId 后，再启用生产触发器。

N8N 不做 `lead_list` 预查。N3 使用严格规范化 companyName 的唯一 dedupKey 收敛同企业命中：保留已有非空联系方式和来源 URL、累积搜索关键词、更新最新有效评分画像，并用独立回执保留每个 idempotencyKey 的 replay/conflict 语义。

N8N 的“每页 20 条”同时是评分聚合和 `lead_upsert` 批写边界：逐条评分、整页校验、一次批写。任一评分 JSON 非法时当前页不调用 Write Agent；之前已经成功写入的页不做补偿删除。Write HTTP 响应丢失时只重放同一锁定正文，已落库条目返回 `replay=true`，不会因模型再次评分产生不同 payloadHash。

## 6. 真实端到端验收清单

先用一小批真实百度清洗结果，最多 20 条，并记录 N8N execution ID；不要在验收记录中复制联系人完整敏感信息。

- FastGPT 返回严格评分 JSON，随后 `lead_upsert` 成功；
- `leads` 中 `aiScore` 为 0～100 整数，profile 六字段齐全，`sourceModelVersion`、`extractorVersion`、来源 URL、搜索关键词和外部线索 ID 正确；
- N8N 重试同一锁定页时各 Lead ID 不变且 `replay=true`；
- 同公司再次命中时返回第一条 Lead ID，不新增 Lead；已有非空联系方式和来源 URL 不变，关键词累积，最新有效评分画像更新；
- phpMyAdmin 只读查看 `lead_write_audits`，确认 CREATED、REPLAY/冲突审计存在且 principal 为 SERVICE；
- 在一页中放入一个测试用非法评分时整页在写调用前失败，该页数据库没有新增行；
- FastGPT、N8N、N3 日志不出现 Prompt、私钥、API Key、JWT、断言或敏感请求头值；
- FULL_READ_ONLY 目录仍为 25 项，N3 目录仍仅 1 项。

全部通过后才启用 N8N 定时/Webhook 触发。真实 DeepSeek 或替代模型的质量、延迟、配额和费用只在本手工验收记录中评价，不进入 CI。

## 7. 更换模型

可以更换，不需要修改 Write Agent、N3、MCP schema、服务断言或 N8N 幂等逻辑。复制 Score Agent 为新版本，选择新模型、绑定其 Secret、更新 `sourceModelVersion`，用同一组严格 JSON/非法 JSON 用例验收后，只切换 N8N 的 Score Agent 凭据/应用版本。Write Agent 与其 SERVICE allowlist ID 保持不变；旧评分版本保留用于快速回退。模型输出契约不满足时不得通过增加宽松解析或静默丢字段来“兼容”。

## 8. 非破坏性回滚

按顺序执行：

1. 在 N8N 面板关闭 Lead Staging 触发器，保留执行历史；
2. 在 FastGPT 面板把 Lead Score/Write Agent 切回上一已验收版本；若要立即切断写入，则从 SERVICE 应用 allowlist 移除 Write Agent ID；
3. 恢复 FastGPT 上一镜像/配置备份并只重启 FastGPT；
4. 代码使用 `git revert <本批提交SHA>` 创建反向提交，不 force push；
5. N3 保持可停用状态，默认保留本批已写入的 Lead 和全部审计记录，人工复核处理。

普通回滚不执行数据库 rollback、不删除 Lead、不清理审计、不修改旧 Lead，也不扩大写账号权限。若 N3 自身异常，转回 N3 runbook 的独立回滚流程；生产数据库恢复必须另行明确授权。
