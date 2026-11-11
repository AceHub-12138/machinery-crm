# 文件清单

对比基线 5d6941e0；包含交付文档及日志，不包含运行时生成目录。

| 类别 | 路径 | 内容 |
| --- | --- | --- |
| 修改 | `.env.example` | 补充获客搜索、反查额度/缓存及开发模拟配置示例。 |
| 修改 | `.github/workflows/full-readonly-linux-acceptance.yml` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 修改 | `DEPLOY.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 修改 | `deploy/fastgpt/v4.15.1/README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 删除 | `deploy/fastgpt/v4.15.1/workflows/lead-score-agent-v1.json` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `deploy/identity-acceptance/.env.identity-acceptance.example` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 修改 | `deploy/identity-acceptance/README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 删除 | `deploy/identity-acceptance/accept-lead-e2e.ps1` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `deploy/identity-acceptance/accept-lead-e2e.sh` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `deploy/identity-acceptance/docker-compose.yml` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 删除 | `deploy/identity-acceptance/lead-e2e-workflow.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `deploy/identity-acceptance/lead-e2e-workflow.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `deploy/identity-acceptance/package-linux-artifact.sh` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 修改 | `deploy/identity-acceptance/prepare-env.mjs` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 修改 | `deploy/identity-acceptance/prepare-env.test.mjs` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 删除 | `deploy/identity-acceptance/provision-lead-e2e.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `deploy/identity-acceptance/validate-env.mjs` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 修改 | `docs/ai-context/00_current_status.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 修改 | `docs/ai-context/03_deployment_notes.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 修改 | `docs/ai-context/06_decisions_log.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 移动 | `docs/mcp/LEAD_CONTACT_ENRICHMENT_V1.md → docs/archive/n8n-lead-pipeline/LEAD_CONTACT_ENRICHMENT_V1.md` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 移动 | `docs/mcp/LEAD_CONTACT_ENRICHMENT_V1_1.md → docs/archive/n8n-lead-pipeline/LEAD_CONTACT_ENRICHMENT_V1_1.md` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 移动 | `docs/mcp/LEAD_E2E_N4_DEPLOYMENT.md → docs/archive/n8n-lead-pipeline/LEAD_E2E_N4_DEPLOYMENT.md` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 移动 | `docs/mcp/LEAD_SCORING_PROMPT_V1.md → docs/archive/n8n-lead-pipeline/LEAD_SCORING_PROMPT_V1.md` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 移动 | `docs/mcp/LEAD_WRITE_N3_DEPLOYMENT.md → docs/archive/n8n-lead-pipeline/LEAD_WRITE_N3_DEPLOYMENT.md` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 新增 | `docs/archive/n8n-lead-pipeline/README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/archive/n8n-lead-pipeline/historical-deploy-fastgpt-v4.15.1-README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/archive/n8n-lead-pipeline/historical-deploy-identity-acceptance-README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/archive/n8n-lead-pipeline/historical-docs-mcp-README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 移动 | `docs/mcp/sql/lead-writer-grants.template.sql → docs/archive/n8n-lead-pipeline/sql/lead-writer-grants.template.sql` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 移动 | `docs/mcp/sql/lead-writer-revoke.template.sql → docs/archive/n8n-lead-pipeline/sql/lead-writer-revoke.template.sql` | 移动至归档目录，保留历史说明及 SQL 原文。 |
| 新增 | `docs/lead-contact-verification/deployment.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/lead-contact-verification/migration-review.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/lead-contact-verification/preflight.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 修改 | `docs/mcp/README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 删除 | `n8n/workflows/README.md` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `n8n/workflows/baidu-lead-contact-enrichment-v1.1.json` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `n8n/workflows/baidu-lead-contact-enrichment-v1.json` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `n8n/workflows/baidu-lead-e2e-n4-pass.json` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `n8n/workflows/lead-staging-v1.json` | 删除旧获客写入、工作流或专用验收代码。 |
| 新增 | `prisma/migrations/20261107010000_add_lead_contact_verification/migration.sql` | 纯新增核验字段、索引和表，不回填历史数据。 |
| 新增 | `prisma/migrations/20261107010000_add_lead_contact_verification/rollback.sql` | 提供需先导出核验数据的结构回滚 SQL。 |
| 修改 | `prisma/schema.prisma` | 追加可空字段及核验、额度模型和保护性关联。 |
| 删除 | `scripts/build-lead-contact-enrichment-workflow.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/issue-lead-service-assertion.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/issue-lead-service-assertion.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-audit-time-contract.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-contact-enrichment-contract.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-contact-enrichment-contract.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-contact-enrichment-workflow.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-e2e-acceptance-support.test.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-e2e-acceptance-support.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-llm-mock.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-llm-mock.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-related-opportunity-workflow.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-scoring-contract.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-scoring-contract.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/lead-workflow-config.test.mjs` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `scripts/provision-mcp-acceptance-accounts.mjs` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 删除 | `scripts/run-lead-e2e-acceptance.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `scripts/run-lead-write-acceptance.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 新增 | `src/app/api/crm/leads/[id]/contact-lookup/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/app/api/crm/leads/contact-lookups/[lookupId]/confirm/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/app/api/crm/leads/contact-lookups/quota/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/app/api/crm/leads/contact-lookups/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/app/api/crm/leads/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/app/api/lead-hunter/tasks/[id]/rerun/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/app/api/lead-hunter/tasks/[id]/reverse-lookup/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/app/api/lead-hunter/tasks/route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/app/api/mcp/route.ts` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 修改 | `src/components/lead-hunter/lead-hunter-client.tsx` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/components/leads/contact-verification.test.tsx` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 新增 | `src/components/leads/contact-verification.tsx` | 管理员核验 Tab、批量进度、对照确认、来源提示和详情卡。 |
| 修改 | `src/components/leads/lead-detail-client.tsx` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/components/leads/lead-list-client.tsx` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 删除 | `src/lib/agent-auth/service-runtime.test.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `src/lib/agent-auth/service-runtime.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `src/lib/lead-hunter/admit.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/lib/lead-hunter/admit.ts` | 逐条事务入池、冲突回执、历史电话核验、无电话延后分配。 |
| 新增 | `src/lib/lead-hunter/contact-authenticity.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/lib/lead-hunter/dedup.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/lib/lead-hunter/engine.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/lib/lead-hunter/engine.ts` | 固定 85 分、原文联系方式核对、去重、搜索容错、取消与报告竞态。 |
| 新增 | `src/lib/lead-hunter/existing-customer.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/lib/lead-hunter/llm.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/lib/lead-hunter/phone.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/lib/lead-hunter/phone.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/lib/lead-hunter/prompts.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/lib/lead-hunter/qianfan.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/lib/lead-hunter/runtime-flags.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/lib/lead-hunter/tianyancha.ts` | HTTPS 客户端、结构化解析、企业与经营状态判断及安全证据。 |
| 修改 | `src/lib/lead-hunter/types.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 删除 | `src/lib/mcp/application.lead-write.test.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `src/lib/mcp/application.ts` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 删除 | `src/lib/mcp/command-tools.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `src/lib/mcp/config.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/lib/mcp/config.ts` | 清理旧获客写入配置及引用，保留身份和只读验收。 |
| 删除 | `src/lib/mcp/prisma-command-data-source.test.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 删除 | `src/lib/mcp/prisma-command-data-source.ts` | 删除旧获客写入、工作流或专用验收代码。 |
| 修改 | `src/middleware.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/middleware.ts` | 让未登录核验请求返回 JSON 401，其他权限规则保留。 |
| 新增 | `src/modules/crm/leads/contact-client.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 新增 | `src/modules/crm/leads/contact-client.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/modules/crm/leads/contact-lookup.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 新增 | `src/modules/crm/leads/contact-lookup.ts` | 管理员反查、数据库额度、缓存、锁、人工确认和分配审计。 |
| 新增 | `src/modules/crm/leads/contact-presentation.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/modules/crm/leads/contact-route.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 新增 | `src/modules/crm/leads/contact-route.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `src/modules/crm/leads/contact-verification-migration.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/modules/crm/leads/read.test.ts` | 新增或调整对应业务回归、权限、并发或迁移验收。 |
| 修改 | `src/modules/crm/leads/read.ts` | 新增白名单筛选和来源字段，限制销售证据返回。 |
| 修改 | `src/modules/crm/leads/types.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 修改 | `src/modules/shared/domain-error.ts` | 配合联系方式核验调整接口、业务契约、原文校验或页面交互。 |
| 新增 | `docs/lead-contact-verification/README.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/lead-contact-verification/evidence/build.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/evidence/changed-lint.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/evidence/lint.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/evidence/prisma-generate.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/evidence/prisma-validate.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/evidence/test.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/evidence/typecheck.txt` | 保存最终检查输出；本机绝对路径已脱敏。 |
| 新增 | `docs/lead-contact-verification/file-changes.md` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
| 新增 | `docs/lead-contact-verification/verification.json` | 更新本期说明、归档追溯、验证证据或部署回滚指引。 |
