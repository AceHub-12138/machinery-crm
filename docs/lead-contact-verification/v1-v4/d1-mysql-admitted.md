# D1：MySQL admitted 类型修复

日期：2026-11-09（America/Los_Angeles）。修复提交：`55ab5d9e0be051c615663a4ca34599f1b2d976b0`，功能分支 `codex/lead-contact-verification`，PR #2。

## 范围和归因更正

只改 `src/lib/lead-hunter/engine.ts` 与 `src/lib/lead-hunter/admit.ts` 两条 SQL 表达式，另在各自现有 fake DB 测试中增加断言。未改入池流程、心跳流程、原心跳不能覆盖入池计数的注释、schema、migration、权限或部署配置。

`git log -S` 确认原表达式由本功能分支 `ebc07015`、`61283cf8` 引入，github/main 不含此表达式。D1 是本功能上线前必须修复的缺陷；上一轮 V2 报告把它称为基线已有风险，该归因不成立。本轮不安排正式数据修复，V4 不排查 D1。

## 全仓 src 读写清单

| 位置 | 实际行为 | 本轮处理 |
| --- | --- | --- |
| `src/lib/lead-hunter/engine.ts:89–96` | touch：从数据库读取 `$.admitted`，与本地其他报告字段合并写入；多次进度心跳共用 | 显式转 SIGNED 后再写 JSON |
| `engine.ts:246–249` | 正常完成：先 touch 写 finishedAt，再仅更新 done/error | 复用已修表达式，无独立 report 写入 |
| `engine.ts:251–265` | 异常／取消收尾：先 touch；再仅更新 failed/cancelled/error | 复用已修表达式；WHERE running 继续防止覆盖已取消任务 |
| `engine.ts:62–71`、`:279–284` | 心跳超时 failed、主动取消：只改状态／错误 | 无 report 写入，不修改 |
| `src/lib/lead-hunter/admit.ts:64` | 事务内 UPDATE：从数据库现值原子 +1 | 对读取值及最终加法结果显式转 SIGNED |
| `src/app/api/lead-hunter/tasks/route.ts:55` | 创建新任务，未指定 report，数据库 SQL NULL | 无独立表达式 |
| `src/app/api/lead-hunter/tasks/[id]/rerun/route.ts:20` | 重跑新建任务；旧报告保留；新 report SQL NULL | 不修改 |
| `src/app/api/lead-hunter/tasks/[id]/cancel/route.ts:21` | 未在进程运行时的取消，只更新状态／错误 | 不修改 |
| `tasks/route.ts:23,30–38`、`tasks/[id]/route.ts` | 列表读取 report；列表入池数按 ADMITTED 候选聚合；详情读取 report、候选及状态计数 | 不修改 |
| `src/components/lead-hunter/lead-hunter-client.tsx` | 读取 report.admitted 并展示，另使用列表 admittedCount | 不修改 |
| `src/lib/lead-hunter/types.ts:63` | 本地 emptyReport 初始化 admitted=0；不是数据库写入 | 不修改 |

检索范围：全仓 `src` 的 lead_hunt_tasks、leadHuntTask 更新／创建、report 赋值和 admitted 引用；未发现第三处 report SQL 写入。

## 先复现、后修复

真实 mysql:5.7.44；utf8mb4 / utf8mb4_unicode_ci；sql_mode 含 ONLY_FULL_GROUP_BY、STRICT_TRANS_TABLES、NO_ZERO_IN_DATE、NO_ZERO_DATE、ERROR_FOR_DIVISION_BY_ZERO、NO_AUTO_CREATE_USER、NO_ENGINE_SUBSTITUTION。仅绑定 127.0.0.1，无主机目录挂载。

| 原表达式场景 | JSON_TYPE | 值／结果 |
| --- | --- | --- |
| 心跳第 1 次 | STRING | `"0"` |
| 心跳第 2、3 次 | STRING | 逐次嵌套引号和转义，原始值见输出文件 |
| 入池：数值 admitted=0 | DOUBLE | 1；成功，无警告 |
| 入池：一次心跳产生的字符串 | DOUBLE | 1；成功，无警告 |
| 入池：三次心跳产生的字符串 | DOUBLE | 1；成功，无警告 |
| 对照：JSON_EXTRACT 直接给 JSON_SET | INTEGER | 0 |
| 对照：原混合类型 COALESCE 后给 JSON_SET | STRING | `"0"` |

严格模式下本次没有入池错误码，不能写成“入池失败”。确认的问题是 JSON 类型写错、心跳重复转义导致计数展示错误；原加法仍可执行，但返回 DOUBLE。根因由同场对照定位到 COALESCE 的混合类型结果。

复现使用真实 JSON 列、InnoDB 和 PREPARE / EXECUTE 参数，接近应用绑定参数形态。见 [复现 SQL](evidence/d1-repro.sql)、[原始输出](evidence/d1-repro-output.txt)。

## 修改表达式与回归

心跳 JSON_SET 值为：

```sql
COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(report, '$.admitted')) AS SIGNED), 0)
```

入池 JSON_SET 值为：

```sql
CAST(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(report, '$.admitted')) AS SIGNED), 0) + 1 AS SIGNED)
```

完整 UPDATE、两行生产代码差异及新增测试见 [修复 diff](evidence/d1-fix.patch)。两处都读取数据库现值；没有把本地旧计数作为写入值。NULL／缺键的基数为 0，首次入池结果自然为 1。

| 回归项 | 结果 |
| --- | --- |
| 连续三次心跳，本地报告故意为 999、数据库为 7 | 均 INTEGER 7，未被本地旧值覆盖 |
| 从 0 入池两次 | INTEGER 1 → INTEGER 2 |
| 心跳／入池／心跳交替 | INTEGER 2 → 3 → 3，不丢、不回退 |
| report SQL NULL / 缺 admitted 键后心跳 | 均 INTEGER 0 |
| report SQL NULL / 缺键后首次入池 | 均 INTEGER 1 |

见 [最终回归 SQL](evidence/d1-regression.sql)、[最终回归输出](evidence/d1-regression-output.txt)。最初数字探针说明仅对读取值转换仍可能使加法结果为 DECIMAL，因此最终还转换加法结果，见保留的 `d1-initial-numeric-probe-output.txt`；不是最终表达式结果。

## 测试与 CI

新增两项 fake DB SQL 形态断言先失败，修复后通过，未修改／放宽原有断言。fake DB 不执行 MySQL 类型转换，实际类型结论以真实 5.7.44 SQL 回归为准。

| 检查 | 结果 |
| --- | --- |
| 定向单测 | 36/36；修复前仅新增的 2 项失败 |
| pnpm test | 161 文件，1295/1295；首轮本机 gzip PATH 缺失，补入已安装 Git usr/bin 后通过，原始失败日志保留 |
| pnpm exec tsc --noEmit | exit 0 |
| pnpm lint | exit 0；既有 warning 保留 |
| 四文件定向 eslint | exit 0 |
| pnpm build | exit 0；进程环境使用仓库外 NEXT_FONT_GOOGLE_MOCKED_RESPONSES，字体来自既有真实 Geist 资源，不改源码／依赖；以 Linux CI 为准 |
| git diff --check | exit 0 |
| 修复提交 Linux PR checks | [成功](https://github.com/AceHub-12138/machinery-crm/actions/runs/42750929219)；tsc、lint、test、原生生产 build 全通过 |

## 数据库、部署与回滚

D1 无字段、表结构或 migration 变化，不需要修复正式数据。当前仅推送功能分支，未合并、未部署。完整验证与复审结束后再批准发布；发布前备份项目、数据库，确认实际 PM2 名称、Nginx、环境变量和持久上传目录。发布使用核验过 SHA 的 CI 产物，新目录部署并保留原运行目录；禁止本机产物直接替代发布包。

如撤销 D1 补丁，在后续功能分支用普通反向提交撤销 `55ab5d9e`，不 reset／amend／force push；正式服务异常按已核验的原启动配置恢复发布前目录，不覆盖 uploads、环境变量或回灌全库。此代码补丁不需要执行核验功能旧 migration 的 rollback.sql。建议提交信息即本次使用的 `fix: 修复获客任务入池计数在 MySQL 中被写成字符串`。
