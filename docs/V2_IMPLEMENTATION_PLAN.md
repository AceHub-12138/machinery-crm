# DachuanPro v2.0.0-rc1 阶段 0：实施计划

## 1. 审计基线与边界

- 审计基线：`origin/codex/agent-canary-integration`，提交 `adfc3bd`（2026-08-03 已执行 `git fetch origin --prune` 后确认）。
- 阶段分支：`codex/v2-audit-design`；总集成分支：`codex/dachuanpro-v2.0-integration`。
- 本阶段只新增设计文档，不修改业务代码、Prisma schema、migration、CI、构建产物、服务器或数据库。
- 原工作目录含未跟踪的 `audit_package/` 和 `dist/`，未作删除或移动；本阶段在同一 Git 仓库的干净 worktree 完成，避免夹带既有文件。

## 2. 当前源码结论

### 已具备且应复用的能力

| 领域 | 已有实现 | 2.0 处理方式 |
| --- | --- | --- |
| CRM 驾驶舱 | `/dashboard`、`/api/dashboard`，含地图、时间/省份/业务员/客户/合同/发货筛选及区域隔离 | 迁至 CRM 语义入口；保留 `/dashboard` 兼容和全国发货路径图 |
| ERP 业务 | 采购需求、采购订单、供应商交期、库存、调拨、盘点、生产工单、齐套、月度计划已存在 | 以服务抽取和驾驶舱聚合为主，不推倒现有状态机 |
| 数据范围 | `getSessionUser()` 每次从 DB 读取启用状态、角色、`territories`、`viewScope`；CRM 使用客户业务线和省市过滤 | 作为 2.0 权限服务的底座，不能换成只读 JWT 声明 |
| 审计 | `OperationLog` 与 `writeOperationLog()` 已被 CRM/ERP 写操作调用 | 先抽取统一脱敏与显示映射，再扩展分页、筛选和对象范围 |
| Agent | `/api/agent/assertion` 仅允许超级管理员签发 600 秒 HS256 assertion；CI 已显式注入两个 `NEXT_PUBLIC_AGENT_*` 变量 | 保持身份桥接和最小权限，Agent/MCP 仅经服务/API，不直连 DB |

### 与目标存在的明确差距或冲突

1. 登录页使用 `signIn(..., { redirect: false })` 后 `router.push('/dashboard')`；这与“成功后整页跳转、等待 Session Cookie 落盘”的 2.0 要求冲突。
2. 根路径无条件 `redirect('/dashboard')`，未按 Session 和角色分流；middleware 也把采购/仓库默认送往具体 ERP 列表而非驾驶舱。
3. 现有 middleware 以粗粒度页面前缀隔离。采购、仓库被限制在 ERP 与设置；销售、外贸禁止全部 ERP。它不等同于 2.0 的模块动作权限矩阵，且 `/api/*` 旧路由并非全部已有同等服务层校验。
4. sidebar 按 CRM 表和单个审批页面组织，且没有滚动位置持久化；目标要求按业务场景分组并聚合审批到 `/tasks`。
5. `OperationLog` API 只支持 action/entityType、最多一次取 200 条；原始 JSON 未脱敏。不能直接作为 2.0 审计后台。
6. 现有 `StockIn` 只有 `batchNo` 和创建时间，没有 `ACTIVE/VOIDED`、作废人/原因/反向流水关联；入库作废必须独立实施。
7. 当前 `KitCheckResult` 没有软删字段；采购订单虽已有 `deletedAt`，但没有删除申请领域状态。两者不可通过菜单逻辑替代。
8. 任务文本将阶段 0 主交付列为五份文档，同时第 20 节明确要求选配项先审计并输出 `docs/V2_OPTIONAL_KIT_ANALYSIS.md`。为不遗漏后者，本阶段交付五份主设计文档加一份限定范围的选配项审计；不实施任何选配项数据库或业务逻辑。

## 3. 实施阶段与预估文件范围

| 阶段 | 分支 | 主要文件范围（预计，实施前复核） | 数据库 |
| --- | --- | --- | --- |
| 0 审计设计 | `codex/v2-audit-design` | `docs/V2_*.md`、`docs/API_*.md`、`docs/MCP_*.md` | 无 |
| 1 导航与双驾驶舱 | `codex/v2-navigation-dashboards` | `src/app/page.tsx`、`src/app/login/page.tsx`、`src/middleware.ts`、`src/components/layout/sidebar.tsx`、`src/app/(app)/dashboard/**`、新增 `src/app/(app)/dashboard/{crm,erp}`、`src/app/api/erp/dashboard/**`、`src/modules/erp/dashboard/**` | 原则上无；仅在 KPI 所需索引经审计证明必要时新增索引 |
| 2 API 领域化 | `codex/v2-domain-api` | `src/modules/{crm,erp,system,agent}/**`、已有 `src/app/api/**/route.ts`、`docs/API_*.md` | 原则上无 |
| 3 待办和平台管理 | `codex/v2-admin-tasks` | `src/app/(app)/tasks/**`、`src/app/(app)/admin/**`、`src/app/api/system/**`、`src/modules/system/**`、`src/lib/sales-items.ts` | 新待办用户状态、权限/配置可追加表；齐套软删列 |
| 4 体验与编号 | `codex/v2-business-improvements` | 合同、生产工单、BOM、入/出库/库存页面与相关 API；新增公共打印组件 | 仅必要的编号规则配置表/索引；现有编号先审计后复用 |
| 5 入库作废 | `codex/v2-stockin-void` | `prisma/schema.prisma`、新 migration/手工 SQL、`src/modules/erp/stock-in/**`、stock-in API/页面、测试 | `StockIn` 作废字段、`StockMovement.reverseOfId`、安全枚举/索引；全部追加 |
| 6 集成 | `codex/dachuanpro-v2.0-integration` | 仅已审查分支的合并冲突处理、版本统一、文档与部署清单 | 汇总已审核 SQL；不在线执行 |

## 4. 阶段交付与停止点

每一阶段必须：从集成分支派生、只包含本阶段变更、提交并推送、列出数据库/API/风险/未完成项后停止等待审查。禁止自行合并、构建、打包或部署。

阶段 1 及其后任何代码变更的本地验证固定为：`pnpm install --frozen-lockfile` → `pnpm exec prisma generate` → `npx tsc --noEmit` → `pnpm test` → `pnpm build` → `git diff --check`。这是本地自查，不等于生成 standalone 成品包或触发 GitHub Actions。阶段 0 纯文档不运行构建；最终集成审查通过且收到明确指令后，才允许 GitHub Actions 打包。

阶段 0 已执行：远端 fetch/分支基线确认、Git 变更范围检查、`git diff --cached --check`、路由/API/页面计数与源码静态盘点、两轴文档审查。阶段 0 未执行：依赖安装、Prisma 生成、TypeScript、测试、构建；原因是本阶段无代码或 schema 变更，且任务明确要求未获指令不得自行构建或打包。

## 5. 版本策略

当前统一来源是 `src/lib/changelog.ts` 的 `CURRENT_RELEASE`，设置页直接读取 `APP_VERSION`；`package.json` 仍是 `1.5.2-rc.1`，CI 也对二者做精确校验。阶段功能分支不改版本。仅在所有阶段已审查并合入集成分支后，同一提交修改：

- `src/lib/changelog.ts`：`v2.0.0-rc1`；
- `package.json`：`2.0.0-rc.1`；
- `.github/workflows/build-standalone.yml` 的版本校验；
- 与版本展示/BUILD_INFO 相关的唯一来源。

## 6. Agent 集成风险

现有桌宠前端依赖构建期内联的 `NEXT_PUBLIC_AGENT_GATEWAY_URL` 与 `NEXT_PUBLIC_AGENT_APP_ID`，并通过 `/api/agent/assertion` 获取用户 assertion。任何将旧 API 直接改名、将 Agent 改为数据库访问、或把 API 注册表变成数据库可编辑路由都会破坏现有安全边界。阶段 2 必须先保留旧 URL，再让旧/新 Route 调用同一服务；阶段 1 的路由迁移不得改变 assertion、Bearer 和 Gateway 合约。

## 7. 驾驶舱固定角色矩阵（阶段 0 审查收敛）

| 角色 | CRM 驾驶舱 | ERP 驾驶舱 | 数据范围 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | 允许 | 允许 | 全公司 |
| `SALES` | 允许 | 禁止 | 国内销售业务线 + 省市 + 负责人 + `viewScope` |
| `FOREIGN_TRADE` | 允许 | 禁止 | 外贸业务线 + 省市/区域 + 负责人 + `viewScope` |
| `PURCHASE` | 禁止 | 允许 | 采购职责和已授权 ERP 数据 |
| `WAREHOUSE` | 禁止 | 允许 | 仓库职责和已授权 ERP 数据 |

阶段 1 必须在页面、API、领域服务和查询四层同时执行该矩阵。用户筛选只能收窄权限：`最终查询 = 用户权限范围 ∩ 合法筛选`，不能把浏览器传入的 `salesUserId`、province、businessLine 或 `viewScope` 当作授权来源。`/dashboard` 是 CRM 兼容入口；禁用角色访问对方驾驶舱页面应安全跳转，API 返回 403。

## 8. 编号设计收敛

手动编号固定为生产工单、入库、出库：后端 `trim`、必填、唯一、冲突 409、受引用后限制修改并写日志。自动编号固定为采购订单 `PO-yyyyMMdd-NNN`、盘点 `SC-yyyyMMdd-NNN`、调拨 `TR-yyyyMMdd-NNN`，每日从 `001` 递增并自然扩展。阶段 4 才落库 `system_number_rules` 与 `system_number_counters`；计数器以 `documentType + dateKey` 唯一并用事务/行锁、唯一约束和有限重试保证并发安全，不能采用无锁“max + 1”。
