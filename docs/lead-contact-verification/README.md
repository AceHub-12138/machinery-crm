# AI 获客联系方式核验施工结论

> 后续 F1–F3 补丁及其独立检查结果见 [复审整改结论](f1-f3-remediation.md)。下文保留原施工验收历史；当前是否满足上线条件应结合补丁报告中的 V1–V4 待办判断。

状态：**离线验收通过，待复审、测试库迁移验证和真实供应商联调；未部署。**

## 1. 分支、基线与提交

- 施工分支：`codex/lead-contact-verification`，目标 remote 为 `github`（AceHub-12138/machinery-crm）。
- 基线：`5d6941e0b82a5a46e76cce4227391bac5ea1650e`，由用户确认采用最新 GitHub main。文档原先的 `609f26c1` 已过时。[完整分支核对](preflight.md)。
- 测试绑定源码提交：`61283cf85eef40edc0403ead47ba49ceea531813`。本报告后续提交仅追加交付证据，不改变业务源码；报告提交 SHA 以分支 HEAD 和交付回复为准。
- 阶段提交用于复审、定位和回滚，**不得把中间施工阶段当作可独立发布版本**；只对最终源码整体验收。

| 提交 SHA | 说明 |
| --- | --- |
| 160db2cfaa3a395fd63513ebebea7b0f80503623 | refactor: 下线 N8N 获客写入链路并保留 MCP 只读能力 |
| 51c27cb0c5c5f5d513c82cbe1b373ddc4b00c09d | feat: 新增线索联系方式核验结构与可回滚迁移 |
| 24a7c366c3e4fcf594de102d13e8c98d0dc53c61 | fix: 建立原文联系方式校验与天眼查真实性底座 |
| 509716a37c7477bddf94c5a4a3597864a3ff46c5 | fix: 固定 85 分获客门槛并修复取消搜索与候选去重 |
| ebc07015b6b8e3840b72fca97130674565c94225 | fix: 逐条事务入池并延后无电话线索分配 |
| 8a55da95b2121a9d622ea183b742f2610d42deff | feat: 新增管理员反查确认与数据库全局额度缓存 |
| 7a87ad5334c0968f6944850e767e30b093b8b4bc | feat: 完成线索核验管理界面与逐条批量反查 |
| 61283cf85eef40edc0403ead47ba49ceea531813 | fix: 收口核验并发边界并补齐配置部署与验收文档 |

## 2. 修改范围

[新增、修改、删除、移动文件的逐项清单](file-changes.md)。

完成 85 分后端门槛、原文电话/邮箱校验、联系人保存、跨任务和 CRM 客户去重、取消竞态/搜索容错、逐条入池事务及冲突回执、无电话延后分配、管理员手动反查、全局数据库额度、缓存、企业身份/经营状态核对、人工确认、权限隔离和前端管理入口。

移除旧 N8N 获客写入入口及专用工作流、脚本和验收服务；历史说明保存在 `docs/archive/n8n-lead-pipeline/`。MCP 现有只读工具实际名称为 `lead_list`、`lead_get`、`lead_stats`，保持原样；未改动只读 tools/data-source 和小川 Agent。

原工作区、历史 migration、LeadSource / LeadReviewStatus 枚举、上传文件、依赖清单、锁文件和 AGENTS.md 均未改动。没有导入、删除或批量改写历史 Lead。

## 3. 数据库

迁移目录：`prisma/migrations/20261107010000_add_lead_contact_verification/`。

[完整 migration SQL、rollback SQL 与风险说明](migration-review.md)。新增 12 个可空字段、相应索引、`lead_contact_lookups` 和 `lead_lookup_daily_quotas`。历史字段不回填；核验外键使用 RESTRICT。

Prisma 校验/生成及 SQL 契约测试通过。**没有执行数据库 up/down**：本机 Docker 引擎未运行，MySQL 5.7 真实往返必须在部署前补做。DDL 可能锁表和部分成功，不能直接在生产试错。

## 4. 环境变量

新增示例：QIANFAN_SEARCH_API_KEY、LEAD_TYC_TOKEN、LEAD_TYC_DAILY_LIMIT（20，最大 500）、LEAD_TYC_CACHE_DAYS（30，最大 365）、LEAD_TYC_MOCK（0）、LEAD_HUNTER_FAKE_SEARCH（0）。真实值只在安全环境配置，未读取运行时密钥。

从旧 MCP/隔离验收模板移除 MCP_COMMAND_*、LEAD_WRITER_AUTH_*、LEAD_SERVICE_ASSERTION_*、LEAD_E2E_*、MCP_LEAD_SERVICE_* 及专用服务 Secret 配置。人类身份及只读配置保留。生产忽略模拟开关；模拟反查不写 Lead 电话/邮箱、不扣额度。真实网络失败保守占用一次预算，charged 表示真实调用尝试，并非供应商账单核销。

## 5. 审核用例对照

原 `lead-hunter-audit-repro/` 未提供，以下用例按施工方案的修复后行为重新编写，未冒充原文件迁入。admit/engine/authenticity 位于 `src/lib/lead-hunter/`；依赖线索池事务、额度的用例放在 `src/modules/crm/leads/contact-lookup.test.ts`，与功能所属模块一致。

| 编号 | 对应用例名 | 结果 |
| --- | --- | --- |
| A1 | `admit.test.ts`：[AUDIT-A1] same-company conflict is ALREADY_IN_POOL and other rows still succeed | 通过（离线） |
| A2 | `admit.test.ts`：[AUDIT-A2] admits 88 without a phone unassigned, rejects 80 | 通过（离线） |
| A3 | `contact-lookup.test.ts`：[AUDIT-A3] quota uses global configuration and returns 429 without calling the provider | 通过（离线） |
| A4 | `contact-lookup.test.ts`：[AUDIT-A4] thrown provider errors release locks and stale locks can be reclaimed | 通过（离线） |
| A5 | `contact-lookup.test.ts`：[AUDIT-A5] a contactless admitted candidate can subsequently be looked up in the Lead pool | 通过（离线） |
| E1 | `engine.test.ts`：[AUDIT-E1] cancellation during the final scoring keeps cancelled | 通过（离线） |
| E2 | `engine.test.ts`：[AUDIT-E2] an invented AI phone becomes a NO_CONTACT candidate | 通过（离线） |
| E3 | `engine.test.ts`：[AUDIT-E3] one failed search does not discard successful search results | 通过（离线） |
| E4 | `engine.test.ts`：[AUDIT-E4] stops when all keywords were already used | 通过（离线） |
| E5 | `engine.test.ts`：[AUDIT-E5] records an existing CRM customer and never makes it admissible | 通过（离线） |
| T1 | `contact-authenticity.test.ts`：[AUDIT-T1] production ignores mocks and missing token never creates numbers | 通过（离线） |
| T2 | `contact-lookup.test.ts`：[AUDIT-T2] changes date at Beijing midnight and mock calls use no quota or Lead contacts | 通过（离线） |
| T3 | `contact-lookup.test.ts`：[AUDIT-T3] mismatch, including admin query override, never writes contacts | 通过（离线） |
| T4 | `contact-lookup.test.ts`：[AUDIT-T4] inactive mismatch is NOT_FOUND without a confirmation queue | 通过（离线） |
| T5 | `contact-authenticity.test.ts`：[AUDIT-T5] splits numbers, removes placeholders, normalizes prefixes and reads emailList | 通过（离线） |

其他验收：名称括号及曾用名匹配、号码去重与前缀清洗、P2002 唯一键竞态恢复、历史电话重新核验、两个管理员并发确认（一成功一 409）、并发额度不超限、缓存 charged=false、旧超时请求不可覆盖接管结果、反查中改名需重新确认、报告 admitted 不被心跳覆盖、四个接口的 401/403/200、完整 24 秒请求上限、销售端无 rawResponse、前端最多 20 条且串行并在 429 停止，以及可空迁移契约均通过。

## 6. 自动检查结果

| 命令 | 原始输出摘要 | 证据 |
| --- | --- | --- |
| pnpm exec prisma validate | exit 0；schema is valid | [日志](evidence/prisma-validate.txt) |
| pnpm exec prisma generate | exit 0；Prisma Client v6.8.2 generated | [日志](evidence/prisma-generate.txt) |
| pnpm exec tsc --noEmit | exit 0；无诊断输出 | [日志](evidence/typecheck.txt) |
| pnpm test | 161 passed 测试文件；1175 passed 用例；exit 0 | [日志](evidence/test.txt) |
| pnpm lint | 622 problems（0 errors, 622 warnings）；exit 0 | [日志](evidence/lint.txt) |
| 最后改动文件 ESLint | exit 0；无诊断输出 | [日志](evidence/changed-lint.txt) |
| pnpm build | exit 0；Compiled successfully；静态生成 122/122 | [日志](evidence/build.txt) |

构建仍有 1 条 Turbopack NFT 文件追踪警告，指向未修改的 next.config.ts → uploads 路径，以及既有 middleware 弃用提示。未宣称这些警告全部消失。

日志把本机 worktree 绝对路径替换成 `<workspace>`，并规范行尾空白及末尾空行；诊断正文未改写；空文件代表该命令无诊断输出，退出码另记录于 [verification.json](verification.json)。Windows 全量测试需要把 Git 的 usr/bin 加入当前进程 PATH，以供现有 gzip/Bash 用例使用；未修改原有用例绕过检查。依赖仅按冻结锁文件离线安装，忽略安装脚本，未更改版本。

## 7. 与原方案的差异和未完成项

- 采用用户已确认的最新 main `5d6941e0`，保留其新增的币种、大屏和安全修复；原本地分支与 main 无共同祖先，没有盲目 pull、merge 或 rebase。
- 保留 `LEAD_WRITE_INTERNAL` 的明确拒绝检查和对应测试。因此“全仓文本出现 0 次”与“识别旧配置并报错”不能同时成立；运行时写工具及注册分支已删除。历史上下文中的追溯记录保留，不能把文本命中等同仍有可用写链路。
- 审核原始复现目录不存在；按行为契约重建测试，事务用例放在所属线索池模块。
- FastGPT 历史补丁中的 gated SERVICE 工具函数保留为兼容/追溯内容，相关 Compose 环境、Secret、应用文件、MCP 写入口和服务身份运行时已移除，无法再形成获客写入链路。
- 未运行 MySQL 5.7 实库迁移往返、真实供应商请求、真实账户计费核对、Docker 全链路验收和登录后浏览器人工验收；这些不由单元测试代替。
- 网页原文出现、企业名称/曾用名与经营状态匹配是本期的自动证据边界，未宣称已人工拨号确认电话号码仍有效。

## 8. 部署步骤与 N8N 运维

[完整逐条命令、作用、正常输出及失败停止条件](deployment.md)：先确认路径/PM2/Nginx/环境 → 完整项目和数据库备份（含 Lead 单独备份）→ GitHub Actions 构建审核后的最终提交 → 上传新目录 → 迁移历史核对 → 应用本次迁移 → 安全填写配置 → 切换 PM2 → 页面验收。不要在生产构建，不覆盖持久化 uploads。

N8N 停用工作流 → FastGPT 停用 Lead 应用 → 审阅归档 revoke 模板回收旧 writer 权限 → 移除旧容器写入配置。**仅提供步骤，外部服务当前状态未被 Codex 改动。**

## 9. 回滚与手工验收

优先恢复旧发布目录/旧代码和原配置，新字段及新表保留。强制结构回滚前必须导出核验记录、额度及两个旧表的新字段；rollback 会丢失核验证据，不能自动还原此前已采用的电话、邮箱或负责人，也不要回灌旧全库覆盖其他新业务数据。

[超管、销售/外贸、失败及 CRM 回归操作清单](deployment.md#5-页面验收)。当前交付不代表已获生产发布许可。
