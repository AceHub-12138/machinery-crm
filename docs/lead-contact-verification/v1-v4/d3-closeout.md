# D3 修复与验收环境重建

## 业务补丁

业务提交：`93bc0c0ea64e7d5dcee9bf6246a9b1ba71d7168e`。

[完整业务 diff](https://github.com/AceHub-12138/machinery-crm/commit/93bc0c0ea64e7d5dcee9bf6246a9b1ba71d7168e)。

- `src/components/leads/lead-list-client.tsx`：行外保存并显示公司名、结果及状态变更后的页签；保留 D2 行内消息，翻页或筛选变化时清除；管理角色的失败及待确认行显示最近反查摘要。
- `src/components/leads/contact-verification.tsx`：单查回传目标状态；消息区支持单条结果；开始批查时切回原有逐条消息。详情历史的原因显示原样保留。
- `src/modules/crm/leads/read.ts`：仅 SUPER_ADMIN 查询 `contactLookups`，与 `requireContactAdmin` 的角色判断一致；按创建时间及 ID 倒序，每条 `take: 1`，只选 `status/reason/isMock/createdAt`；输出为 `latestContactLookup`。销售和外贸既不查询该关系，也不返回摘要或关系字段。
- `src/modules/crm/leads/types.ts`：增加可选摘要类型。
- `src/components/lead-hunter/lead-hunter-client.tsx`：ADMITTED 且有 leadId 才显示当前标签页的“查看线索”；公司名保留新标签页来源链接并增加 title。

## 新增测试

- `src/components/leads/lead-lookup-refresh.test.tsx`：D3 待反查 → 反查无果后原行消失，刷新结束仍能看到公司名和模拟原因；切换筛选清除提示；失败行显示最近原因；批查逐条消息在刷新后仍可见；后续单查替换批查消息，翻页清除提示。原 D2 两项断言保留。
- `src/components/lead-hunter/lead-hunter-links.test.tsx`：已入池且有关联才显示 `/leads/lead-123`，不设置新标签页；来源 URL、title 和 `_blank` 保持正确。
- `src/modules/crm/leads/read.test.ts`：超管查询恰好四字段、最近一条；SALES 和 FOREIGN_TRADE 各自不查询关系；即使依赖意外返回关系数据，列表输出也剔除，不泄露原因。

D3 回归测试修复前明确失败：原行消失后页面不含“验收测试甲：模拟数据，不可采用，已移至‘反查无果’”。修复后通过。

## 检查结果

- `pnpm test`：163 个文件、1304 项通过。Windows 运行时把现有 Git 的 usr/bin 和 bin 加入进程 PATH，供既有 gzip/bash 测试使用，未修改或跳过断言。
- `pnpm exec tsc --noEmit`：0 诊断。
- `pnpm lint`：0 errors、622 条既有 warnings；定向 ESLint：0 errors、1 条既有 warning。
- `pnpm build`：通过；本机使用验收脚本已有字体内容生成临时静态响应，构建后移除临时文件。
- `git diff --check`：通过。
- [业务提交 Linux PR checks](https://github.com/AceHub-12138/machinery-crm/actions/runs/42935368251)：success，含正常字体配置下的 generate、tsc、lint、test、build。

## 验收数据与清单

`acceptance-env/seed.cjs` 的候选和线索来源统一为 `https://example.com/acceptance-source`。专用线索分别为：模拟单查 mock-single；额度单查 quota-single；额度批查 quota-a/quota-b；未配置单查 offline；未配置批查 offline-a/offline-b；采用 compare；驳回 no-name；北区/南区/外贸各自 north/south/trade。入池步骤仅使用任务中的候选。

`acceptance-env/check.cjs` 使用独立单查和批查样本，保留所有原有断言并增加实际列表权限字段断言；429 和 503 抽查不改变样本状态，不对 mock-single 反查，不采用、驳回或入池，留给人工验收。

`v2-page-acceptance.md` 原实际操作、结果和截图逐行比对保留。当前 14 项步骤的实际结果为空，因此均标“需重做”；旧记录中任务、核验和角色线索相关 7 项需重做。历史工作台、客户及报价、合同及回款、发货空列表 4 项展示结论标“重建后无需重做”，不代表新样本写入已验收。

本轮运行和实际 API 权限证据见 [重建自查记录](evidence/d3-rebuild.txt)。

## 数据库、部署与回滚

无 schema、表字段、migration 修改；没有新增迁移。仅在全新一次性本机 MySQL 5.7 容器执行已有 migrate deploy 和验收 seed。

重建步骤：先保存验收记录；运行 stop-acceptance.ps1，核对专用资源后输入 y 清理；再运行 start-acceptance.ps1，等待三个地址就绪。临时账号重新生成，旧密码失效。没有部署正式环境，也未修改正式服务器配置或上传文件。

若需退回旧验收代码：先保存记录并停止本轮一次性环境；在功能分支使用普通 revert 撤销 docs 提交，再 revert 上述业务提交（会生成新提交，禁止 reset/force push）；重新运行启动脚本。回滚环境仍会生成全新测试数据，不能恢复已清理的旧验收写入。正式数据和上传目录不受本轮操作影响。

## 禁止事项核对

未连接正式库或远程数据库、未调用真实供应商、worktree 未建 .env；未使用 migrate dev/reset/db push；未修改 prisma/、.github/、合同/发货/上传代码，未新增 migration；未合并 PR、未推送 main、未运行 build-standalone、未 force push/reset/clean/amend；逐个路径暂存，未使用 git add -A 或 git add .。AGENTS.md 未改动。
