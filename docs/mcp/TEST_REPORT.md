# DachuanPro 统一只读 MCP 测试报告

- 日期：2026-07-17
- 基线：`29d92dae606112def7c17b0530940210ebb0dfe7`
- 分支：`codex/unified-readonly-mcp`
- 状态：本地代码门禁通过；Docker 实构建因当前机器未安装 Docker 未执行

## 自动化覆盖

- API Key 哈希鉴权、Host/Origin allowlist、禁用用户拒绝。
- MCP initialize、21 个工具发现与逐工具固定分发、统一文本/结构化返回（含非法参数）。
- MCP 官方 Streamable HTTP 客户端完整握手、发现和工具调用，客户端标识模拟 FastGPT 4.15.1。
- 客户业务线/省市负责范围下推到 Prisma where。
- 非 ERP 角色在发起 Prisma ERP 查询前拒绝。
- 合同/发货客户隔离、库存预警阈值、出入库/流水固定过滤、仓库采购状态、BOM/供应商详情限制、采购生产视图。
- 即时齐套只读计算，不创建齐套记录、不更新工单、不变更库存。
- 审计成功、鉴权拒绝审计、审计不可用时失败关闭、审计不保存参数值。

## 最终结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全仓自动化测试 | `corepack pnpm test` | 17 个测试文件、87 项测试全部通过 |
| TypeScript | `corepack pnpm exec tsc --noEmit` | 通过，0 错误 |
| ESLint | `corepack pnpm lint` | 通过，0 错误；510 条 warning（含仓库既有 warning，本次 MCP 数据源 6 条 `no-explicit-any` warning） |
| Next.js 生产构建 | `corepack pnpm build` | 通过；构建清单包含 `/api/mcp`、`/api/mcp/health` |
| standalone 产物 | `Test-Path` 静态检查 | `server.js`、MCP route、health route 均存在 |
| diff 格式 | `git diff --check` | 通过；仅有 Windows 行尾提示，无空白错误 |
| 数据库结构范围 | `git diff --name-only 29d92da -- prisma/schema.prisma prisma/migrations` | 无输出，确认未修改 schema/migration |
| Docker 镜像 | `docker version` | 未执行；当前 Windows 环境没有 `docker` 命令 |

## 未在本机声称完成的验证

- 未连接生产 MySQL，未执行 migration、seed 或任何业务数据写入测试。
- 未在真实 FastGPT 实例中保存连接；兼容性由 FastGPT 4.15.1 同款 MCP SDK Streamable HTTP 客户端完成握手、工具发现和调用自动化验证。
- Dockerfile 与 Compose 已完成静态检查，但必须先在有 Docker Engine 的 Linux CI/构建机执行镜像构建，再在服务器加载镜像并通过健康检查，方可准入部署。

## 上线前手工验收清单

1. 超级管理员绑定 Key：发现 21 个工具；客户/合同/发货可跨范围查询；BOM 详情和即时齐套可调用。
2. 区域销售绑定 Key：只能查询所属业务线及负责省市的客户、跟进、合同和发货；任一 `erp_` 工具返回 `FORBIDDEN`。
3. 外贸销售绑定 Key：只能查询外贸业务线及负责区域；国内客户 ID 直接查询返回无权访问。
4. 采购绑定 Key：供应商/采购订单可查询，生产工单为采购受限视图，BOM 详情和即时齐套被拒绝。
5. 仓库绑定 Key：采购订单草稿/取消状态被拒绝；库存、出入库和流水可查询。
6. 使用错误 Key、禁用用户、错误 Host 各调用一次，确认请求被拒绝并存在 `MCP_CALL` 审计记录。
7. 暂时阻断 `OperationLog` 写入，在隔离环境确认已认证查询返回 503 且不交付结果，随后立即恢复。
8. 调用即时齐套前后对比工单、库存和齐套历史，确认没有新增齐套结果、状态更新或库存变化。
9. 回归现有 CRM 登录、客户、合同、发货页面及 ERP 生产/采购/库存页面，确认主实例与 uploads 未受独立 MCP 容器影响。
