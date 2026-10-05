# N8N Lead 工作流归档

## `baidu-lead-e2e-n4-pass.json`

该文件是 2026-08-20 真实生产链路完成 N4 E2E PASS 后导出的百度获客工作流基线。它与 `lead-staging-v1.json` 不是同一工作流，归档时没有覆盖或宣称两者等价。

为避免提交环境绑定信息，归档文件只将三个生产 Credential ID 替换为 `REPLACE_*` 占位符，保留了 Credential 名称、节点、连接和业务表达式。导入其他 n8n 环境后，必须在 GUI 中重新绑定：

- 百度搜索 Header Auth Credential；
- FastGPT Lead Agent Header Auth Credential；
- Dachuan Lead Ingestor Header Auth Credential。

为保留真实 E2E PASS 导出的可追溯性，文件仍包含当时的 FastGPT appId、内部服务 URL，以及 n8n 导出的 workflow/version/instance ID。这些值不是密钥、Token 或授权凭据，也不能替代 Credential；它们只代表验收环境。导入其他环境时必须逐项核对 FastGPT appId 和服务地址，workflow/version/instance ID 可由目标 n8n 重新生成，不得据此假设环境已经配置完成。

`Search Config.search_keyword` 是本次验收使用的配置值，不是写死的业务规则；每次运行前可在 `Search Config` 节点修改。百度 HTTP Request 必须继续动态读取该字段。

N4 基线的幂等与 payload 契约不得降级：

- `payloadHash = SHA256(canonicalJson)`；
- 幂等种子为 `lead-idempotency-v2|$execution.id|sourceSystem|sourceUrl`；
- 最终键前缀为 `lead-v2-`；
- 不得把 `$execution.id` 删除，也不得改回仅以 `sourceUrl` 做永久幂等。

该归档不包含 API Key、Token、JWT 私钥或数据库密码。导入后应保持工作流停用，完成 Credential 重绑和配置复核后，再按部署 runbook 单独授权启用。

## `baidu-lead-contact-enrichment-v1.json`

该文件固定基于 `baidu-lead-e2e-n4-pass.json` 生成，是独立、默认停用的 Lead 联系方式反查 v1；不会覆盖或修改 N4 PASS 归档。生成源码为 `scripts/build-lead-contact-enrichment-workflow.mjs`，契约与行为测试位于：

- `scripts/lead-contact-enrichment-contract.test.mjs`；
- `scripts/lead-contact-enrichment-workflow.test.mjs`。

集中配置默认值：

- `contact_search_enabled = true`；
- `contact_search_score_threshold = 90`，判定严格使用 `aiScore > threshold`；
- `contact_search_max_rounds = 3`，生成器和每轮预算门再次硬限制为最多 3；
- `contact_search_top_k = 5`。

工作流显式展开三个独立 Round，因此 `contactSearchRound` 不复用外层搜索计数，也不存在无限循环：

- Round 1 使用确定性公司全称 Query，不调用 Planner；
- Round 2 / Round 3 各最多调用一次 AI Query Planner；
- 百度结果先由 Code 节点提取候选 phone/email；没有候选时不调用 Contact Verifier；
- 验证成功立即进入最终 `aiScore >= 80 AND (valid phone OR valid email)` 门槛，不再执行后续 Round；
- 三轮耗尽、百度异常、Planner/Verifier 非法输出均只终止当前 Lead 分支，不 throw 中断整个 workflow；
- `contactSearchRound` 和 Query 不进入 Lead MCP 幂等键，原 N4 `lead-idempotency-v2|$execution.id|sourceSystem|sourceUrl` 保持不变。

除 N4 已有三个 Credential 外，导入后还必须在 N8N GUI 人工绑定：

- `REPLACE_FASTGPT_QUERY_PLANNER_CREDENTIAL`；
- `REPLACE_FASTGPT_CONTACT_VERIFIER_CREDENTIAL`。

并替换三个 FastGPT App ID 占位符：

- `REPLACE_FASTGPT_LEAD_AGENT_APP_ID`；
- `REPLACE_FASTGPT_QUERY_PLANNER_APP_ID`；
- `REPLACE_FASTGPT_CONTACT_VERIFIER_APP_ID`。

两个 Agent 的准确 Prompt、JSON Schema、拒绝规则和 `profile.province/profile.city` 回填契约见 `docs/mcp/LEAD_CONTACT_ENRICHMENT_V1.md`。本仓库文件不代表运行中的 FastGPT/N8N 已被修改；本批没有连接或更新线上服务。

## `baidu-lead-contact-enrichment-v1.1.json`

该文件是 v1 的独立小版本，不覆盖 v1、N4 或 `lead-staging-v1`。v1.1 把 Contact Verifier 结果升级为三分类：

- `DIRECT_CONTACT`：只补全原目标 Lead；
- `RELATED_OPPORTUNITY`：联系方式属于另一家明确企业，且有制造、加工、设备采购、扩产或技改证据；
- `REJECT`：平台客服、新闻作者、无关企业或只有经销/代理关系但没有机床潜客价值。

关联机会每轮最多一个，并必须重新调用现有 Lead Agent 独立评分。N8N 会锁回 Verifier 已验证的关联企业名称和 phone/email，只有 `aiScore >= 80` 且联系方式有效时才进入派生 Lead MCP 支路。派生支路直接复用 v1 的 canonical payload、SHA-256、`lead-idempotency-v2`、Finalize 和 Lead MCP Upsert 节点；服务端继续执行 company dedup、REPLAY/CONFLICT 和自动区域分配。

派生 Lead 写入或评分淘汰后会恢复原目标的 `contactSearchRound` 并继续剩余 Round。派生 Lead 不进入 Contact Entry Gate，不会再次触发百度反查；因此整条原目标链路仍最多三次联系方式搜索、最多处理三个关联机会，不会递归扩散。

v1.1 新增占位符：

- `REPLACE_FASTGPT_CONTACT_VERIFIER_V11_APP_ID`；
- `REPLACE_FASTGPT_CONTACT_VERIFIER_V11_CREDENTIAL`。

准确 Prompt、JSON Schema、机会类型及拒绝规则见 `docs/mcp/LEAD_CONTACT_ENRICHMENT_V1_1.md`。新 workflow 默认 `active=false`；本分支没有连接、导入或修改运行中的 N8N/FastGPT。
