# 公开大屏数据口径施工结果

日期：2026-10-09。依据桌面两份施工单、《大屏数据口径-施工计划.md》及用户确认的 7 项 A 方案。

## 交付状态与基线

- 施工分支：`codex/screen-data-reconcile`。
- 隔离目录：`/Users/apple/Desktop/Codex/machinery-crm-screen-data`。
- 基线：`609f26c`，刷新远端后采用最新 `origin/main`；与计划中的 `a8576dc` 比较，新增安全修复未触及本批 screen/dashboard 模块。
- 原目录与用户文件保留。没有数据库迁移、生产数据修改、服务器配置修改、合并、推送或部署。
- 本地施工交付后待 Claude 复查；生产提交、目标重复行、真实对账尚未核实。Task 11 真实快照接入另批实施。

## 最终业务口径

| 指标 | 数据集合与含义 |
| --- | --- |
| 本期合同数 | 合同与客户均未软删除；SIGNED / COMPLETED；按既有 createdAt 判断本期；不排除外币计数 |
| 本期合同额 | 上述集合，进一步限定 CNY，Decimal 求和 |
| 本期实收 | 本期 paymentDate 的 ACTIVE 回款流水，关联合同与客户未软删除且合同币种 CNY；包含老合同、取消合同的有效实收，排除作废流水 |
| 本期新合同欠款 | 本期有效 CNY 合同自身 unpaidAmount；不以合同额减本期全部实收 |
| 累计金额 | 未软删除 CNY 合同，SIGNED / COMPLETED / ARCHIVED；排除 DRAFT / CANCELLED |
| 累计回款率 | 累计 paidAmount / 累计 amount；由公开出口计算，界面直接读取 collection.collectionRate |
| 本期实际完成 | kpis.periodContractAmount；没有目标也保留实际值 |
| 客户跟进 | 排除软删除；成交 WON 客户仍纳入；今日、未来桶、逾期不重叠 |
| 发货 | SHIPPED / PARTIAL_SHIPPED；不额外限制币种；同一合同分两次发 2 台和 3 台，累计 5 台 |
| 地区 | 标准省份全量聚合；未知地区单列，不增加省份数，不落地图点位，但保留总发运次数与台数 |

新增 `screen-metrics.ts` 为公开接口提供固定公司口径；不修改 CRM 工作台可选筛选的共享服务，也不改变已有销售目标录入的 >0 要求。

## 时间与目标

- 北京时间月份及本期时间戳区间：[月初北京 00:00，查看日次日北京 00:00)。
- Prisma DATE 列按业务日 UTC 零点编码另算边界，不能照搬时间戳的 -8 小时边界。
- 今日：[今日，明日)；七日内：[明日，今日+7日)，实际为未来 6 个日历日；逾期：早于今日。
- 公司合同额月目标直接读取匹配的 MONTH / CONTRACT_AMOUNT / salesUserId=null，按 updatedAt desc、id asc 取最新一条，未清理历史行。
- `targetConfigured=false` 表示未设置，实际值仍在；历史零元记录为 true 且不除零。界面分别显示“目标未设置”“目标为 0”。
- 负金额与负计数保留；负计数记录仅含字段与数值的异常日志，无客户名、业务身份、publicId。

## 公开字段与样本

新增兼容性字段（平台固定输出；旧消费者可忽略）：

- `collection.targetConfigured`。
- `delivery.regionUnits`：标准省份的 shipmentCount / unitCount。
- `delivery.unresolvedRegionTotals`：地区待确认的 shipmentCount / unitCount。
- `delivery.routesTotal`：完整发货集合的展示发运次数，包含无法落点记录；不是可落点样本数。
- `delivery.milestonesTotal`：上述发货集合中 SHIPPED 整单发出记录的展示次数。
- `delivery.reminders.todayTotal / sevenDaysTotal / overdueTotal`：与到期 KPI 相同的完整集合。

一次全量发货读取同时生成汇总、地区聚合与样本，后续截断不影响总量。路线最多 80 条，里程碑最多 5 条，每组提醒最多 2 条；提醒来源先取 8 条再筛地区，有未知地区时可展示少于 2 条，但明确标为样本并保留完整计数。

倍率保持既有整数 1–100，只在 `transformToPublicPayload` 应用一次。regionCount 不乘倍率；汇总、各省份和未知地区台数及次数使用同一发货倍率，满足：

```
sum(regionUnits.unitCount) + unresolvedRegionTotals.unitCount = summary.unitCount
sum(regionUnits.shipmentCount) + unresolvedRegionTotals.shipmentCount = summary.shipmentCount
regionUnits.length = summary.regionCount
```

公开 API 保持显式白名单，未知原始地区文字不输出；标准省/市中心点、设备型号及受控脱敏合同尾号延续原保护。内嵌公开大屏同步修正累计回款率、目标守卫、样本标签、北京时间、全量省份排行与热力图；没有改 `.screen-*` 基线样式。

## 本地验证

- 全量 Vitest：164 个文件、1257 项测试全部通过。
- `tsc --noEmit`、生产 `pnpm build`、本批修改文件 ESLint、`git diff --check` 通过。
- 扩展检查整个 screen 目录的 ESLint 为 0 error / 10 warning，均在未修改的历史 `config.test.ts`；本批修改文件为 0 warning。
- 在 `TZ=UTC` 与 `TZ=America/New_York` 下单独运行 4 项日期/查询口径测试，均通过。
- 构建使用专门的无生产权限占位数据库 URL，不连接或改写业务数据库；构建日志中的既有 next.config 导入告警不影响成功构建。
- 历史中间失败：将省份覆盖标签从“大区”纠正为“省份”后，1 条旧文案断言未同步；修正断言后全量重跑为上述通过结果。

口径数据集验证（非生产数据）：本期 CNY 合同额 300000，实收 210000，新合同欠款 230000；累计金额 700000，累计已回 260000，累计未回 440000。本期合同数 3（其中含 USD 合同），金额不含 USD。这个案例刻意证明本期实收+新合同欠款不等于本期合同额。

覆盖月初北京 02:00、DATE/时间戳不同边界、月底及次日排除边界、成交客户跟进、软删除合同和客户、ACTIVE/VOIDED 流水、老/取消合同回款、未发货状态排除、分批 2+3、86 条路线截断、未知地区、不同倍率、缺目标与历史零目标、负计数日志及公开字段保护。

## 生产对账与回滚准备

提供 `scripts/check-screen-target-duplicates.sql`，仅 SELECT 聚合公司的目标重复组，不输出目标金额、人员或公司名称。本轮没有生产只读连接，脚本未在生产执行；重复数据是否存在待核查。

部署前由获准人员核对：生产当前提交、上述重复目标查询、月初与当前窗口、本期新合同额/自身欠款、按 paymentDate 的 ACTIVE CNY 实收、累计有效合同、发货 2+3 与地区守恒、目标标记及倍率。单据中的历史生产数字不作为本次通过证据。

上线前备份项目、数据库与配置，确认上传目录、服务与回退提交。先验证平台响应，再验证匹配大屏显示和语音。字段或部署不兼容时回退两端至配套版本；本批没有数据库结构变更，不能通过改历史业务数据来“对平”数字。

待 Claude 审核本批字段与查询条件，再处理合并；推送、生产部署、现场硬件验收分别报告。
