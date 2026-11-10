# V1–V4 本地验收记录

日期：2026-11-09（America/Los_Angeles）。修复基准 `55ab5d9e0be051c615663a4ca34599f1b2d976b0`，分支 codex/lead-contact-verification，PR #2。

| 项目 | 状态 | 范围与限制 |
| --- | --- | --- |
| V1 MySQL 5.7 迁移往返 | 通过 | 沿用上一轮已通过报告；本轮已重建到 C，仅追加回滚文档修订建议 |
| V2 测试库完整流程 | 待用户页面验收 | D1 SQL、真实 MySQL、获客／核验 API、已执行页面通过；剩余页面因电脑操作停止等原因单列，不能当作全量上线验收通过 |
| V3 天眼查联调 | 暂缓 | 未充值；方案已写，未调用真实供应商 |
| V4 正式库只读排查 | 待管理员执行 | 完整 SQL 已写并在真实 5.7.44 基线 schema 上试跑成功；未连接正式库 |

- [D1 复现、位置清单、修复与检查](d1-mysql-admitted.md)
- [V1 报告及 deployment.md 第 7 节修订建议原文](v1-mysql-roundtrip.md#deploymentmd-第-7-节修订建议)
- [修复后 V2-a／V2-b 逐项结果](v2-test-workflow.md)
- [页面截图与待用户页面验收清单](v2-page-acceptance.md)
- [V3 联调方案：暂缓（未充值）](v3-tyc-trial.md)
- [V4 说明](v4-prod-readonly-scan.md)、[V4 SQL 全文](v4-prod-readonly-scan.sql)、[基线试跑输出](evidence/v4-retest-baseline-syntax.txt)
- [上一轮 V2 停测原文（归因已更正）](v2-initial-stopped.md)
- [本轮清理记录](evidence/cleanup-retest.json)、[禁止事项确认](prohibitions.md)

D1 属于本功能分支新增问题；不是正式环境原有脏数据。本轮无正式数据修复、schema／migration 变化。业务修复单独提交并已通过 [Linux PR checks](https://github.com/AceHub-12138/machinery-crm/actions/runs/42750929219)。文档单独提交／普通推送，精确 SHA 与该次 PR checks 结果在交付回复中记录。

没有合并 PR、推送 main 或部署。V2 部分页面仍待验收、V3 暂缓和 V4 未执行，均不能据此批准上线。建议 docs 提交信息：`docs: 补齐 D1 回归及 V2-V4 验证材料`。

清理尚未完全闭合：容器、匿名卷、服务进程已删除，测试端口关闭；仓库外本轮临时目录删除被自动审批审核以 `blocked by policy` 拒绝，保留待用户本机清理，未绕过拦截。
