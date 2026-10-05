# FULL_READ_ONLY 可信身份只读工具验收报告

- 日期：2026-07-20
- 分支：`codex/unified-readonly-mcp`
- 身份验收修复基线：`d4cf5d2`（`fix: 完善身份验收资源清理与证据落盘`）
- 模式：仅在 Docker 隔离环境启用 `MCP_TOOL_MODE=FULL_READ_ONLY`
- 结论：本地代码门禁、Docker Linux 镜像构建和 FULL_READ_ONLY 隔离验收通过；未连接生产数据库、未部署、未推送

## 真实角色枚举与模块权限

映射直接来自 `prisma/schema.prisma` 的 `Role` 枚举和 `src/lib/erp-roles.ts`，未按名称猜测，也未修改 Prisma Schema。

| 数据库枚举值 | 中文角色 | 现有模块权限 |
| --- | --- | --- |
| `SUPER_ADMIN` | 超级管理员 | CRM 全范围；查看 ERP；供应商、采购、库存、BOM、物料主数据、生产下达、齐套与生产用料权限 |
| `SALES` | 销售 | 国内销售业务线，并按 region/territories/viewScope 限制 CRM 数据；无 ERP 权限 |
| `FOREIGN_TRADE` | 外贸业务 | 外贸业务线，并按 region/territories/viewScope 限制 CRM 数据；无 ERP 权限 |
| `PURCHASE` | 采购 | 查看 ERP；管理供应商和采购订单；现有 GET 接口还允许读取库存、出入库、库存流水、BOM 列表和生产工单；无库存管理、BOM 详情/维护、物料主数据、生产下达和齐套执行权限 |
| `WAREHOUSE` | 仓库管理 | 查看 ERP；管理库存、出入库和生产用料；现有 GET 接口还允许读取供应商列表、BOM 列表和生产工单，采购订单仅可读已提交状态；无供应商详情/管理、采购管理、BOM 详情/维护、物料主数据、生产下达和齐套执行权限 |

项目不存在 `PROCUREMENT` 枚举。采购的真实枚举为 `PURCHASE`，仓库为 `WAREHOUSE`，两者权限不等价。

## FULL_READ_ONLY 工具目录

身份工具：`dachuan_identity_who_am_i`。

21 个只读业务工具：

1. `crm_customers_list`
2. `crm_customer_get`
3. `crm_customer_follows_list`
4. `crm_products_list`
5. `crm_product_get`
6. `crm_contracts_list`
7. `crm_contract_get`
8. `crm_shipments_list`
9. `crm_shipment_get`
10. `erp_suppliers_list`
11. `erp_supplier_get`
12. `erp_purchase_orders_list`
13. `erp_purchase_order_get`
14. `erp_inventory_list`
15. `erp_stock_documents_list`
16. `erp_stock_movements_list`
17. `erp_boms_list`
18. `erp_bom_get`
19. `erp_production_orders_list`
20. `erp_production_order_get`
21. `erp_kit_check`

FULL_READ_ONLY 的 `tools/list` 总数为 22。

## 五角色逐工具权限矩阵

`允许`表示工具级允许，实际数据仍受数据库实时用户状态和 Prisma `where` 数据范围约束。`受限允许`表示仓库可查看采购订单，但查询条件强制限制为已提交状态。

| 工具 | SUPER_ADMIN | SALES | FOREIGN_TRADE | PURCHASE | WAREHOUSE |
| --- | --- | --- | --- | --- | --- |
| 9 个 `crm_*` 工具 | 允许 | 允许，国内区域范围 | 允许，外贸区域范围 | 禁止 | 禁止 |
| `erp_suppliers_list` | 允许 | 禁止 | 禁止 | 允许 | 允许 |
| `erp_supplier_get` | 允许 | 禁止 | 禁止 | 允许 | 禁止 |
| `erp_purchase_orders_list/get` | 允许 | 禁止 | 禁止 | 允许 | 受限允许 |
| `erp_inventory_list` | 允许 | 禁止 | 禁止 | 允许 | 允许 |
| `erp_stock_documents_list` | 允许 | 禁止 | 禁止 | 允许 | 允许 |
| `erp_stock_movements_list` | 允许 | 禁止 | 禁止 | 允许 | 允许 |
| `erp_boms_list` | 允许 | 禁止 | 禁止 | 允许 | 允许 |
| `erp_bom_get` | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |
| `erp_production_orders_list/get` | 允许 | 禁止 | 禁止 | 允许 | 允许 |
| `erp_kit_check` | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |

自动化测试执行完整的 21 工具 × 5 角色矩阵，共 105 个工具/角色组合。每个工具覆盖允许角色、禁止角色、停用用户、角色实时变化和五类伪造身份字段。7 个带客户范围的列表/详情工具逐项验证跨业务线或区域数据不可见；产品主数据是现有全局 CRM 读模型，验证国内销售与外贸均可读取；ERP 工具没有 region/territories 数据范围，按真实 ERP 模块角色验证跨模块调用被拒绝。两名销售并发查询不同业务线和区域时未发生串数据。

## 安全控制核对

- `tools/list`：必须验证 FastGPT 服务 Key 和调用方 `requestId`，无需用户断言。
- `tools/call`：同时验证服务 Key、用户短期断言和调用方 `requestId`；缺少 requestId 时拒绝，不生成替代值。
- 服务 Key 不绑定 userId 或业务角色，不能自动获得管理员权限。
- 所有工具参数使用严格 Schema，未知字段以及 `userId`、`role`、`region`、`territories`、`viewScope` 均被拒绝。
- 每次业务调用按断言 sub 重新查询 `isActive`、`role`、`region`、`territories`、`viewScope`。
- 数据权限直接进入 Prisma `where`；详情 ID 与权限范围合并在同一次查询；详情使用字段白名单 `select`。
- 列表默认每页 20，最大 100；搜索词最长 100 字符；日期起止必须成对提供，跨度最大 366 天。
- `MCP_QUERY_TIMEOUT_MS=5000` 限制应用等待时间。
- 库存预警候选物料硬上限为 500；超过上限返回范围过宽错误，不构造无界 Prisma `OR`。
- OperationLog 仅记录 userId、requestId、工具名、状态和固定拒绝原因等最小元数据，不记录查询词、完整参数、返回正文或凭据。
- 全部业务工具只读，不创建、修改、审批、删除业务数据，不接受或执行任意 SQL。

## 实际门禁结果

| 门禁 | 命令或证据 | 结果 |
| --- | --- | --- |
| 单元测试 | `corepack pnpm test` | PASS；21 个测试文件、129 项测试 |
| TypeScript | `corepack pnpm exec tsc --noEmit` | PASS；0 错误 |
| ESLint | `corepack pnpm lint` | PASS；0 错误、511 条仓库 warning |
| 生产构建 | `corepack pnpm build` | PASS；包含 `/api/mcp` 和 `/api/mcp/health` |
| Docker 镜像构建 | `docker build`（CRM/MCP、Runner） | PASS；Prisma 生成、Next.js 生产构建、Runner 构建均通过 |
| 隔离数据库保护 | 启动脚本网络与端口门禁 | PASS；内部 Docker 网络，未发布 MySQL 主机端口，db-init 退出码 0 |
| FULL_READ_ONLY 验收 | `accept.ps1 -ExpectedToolMode FULL_READ_ONLY` | PASS；Runner 自然退出码 0，15 组检查通过 |
| 结果 JSON | `20260720-175734-result.json` | 非空、可解析、`overallStatus=PASS` |
| 工具目录 | 验收 Runner | PASS；身份工具 + 21 个业务工具，共 22 个 |
| OperationLog 抽检 | 隔离 MySQL 最新成功/拒绝记录 | PASS；可信 userId/requestId/tool/status/rejectionReason 可归因 |
| 最终敏感扫描 | 结果 JSON `sensitiveScanStatus`、`finalSensitiveLogScanStatus` | PASS / PASS |
| Linux 脚本语法 | Docker Linux 环境执行三次 `bash -n` | `accept.sh`、`start.sh`、`rollback.sh` 均退出码 0 |
| 禁改文件 | Git diff | `package.json`、`pnpm-lock.yaml`、`prisma/schema.prisma`、`prisma/migrations` 零修改 |

验收证据：`deploy/identity-acceptance/acceptance-output/20260720-175734-result.json`（被 Git 忽略，不提交）。该次验收记录了 167 个 requestId，去重后仍为 167。

## 镜像 ID

- CRM/MCP：`sha256:0f7a827254a0a1a77cef07429f81ebf00d7f05c14d6f1950f5f34534fb993871`
- 验收 Runner：`sha256:b9646b58f6dda8297d6171d228f5d5df444ea8db1f837ecdec769ba4621b569c`
- FastGPT 4.15.1 身份补丁验收镜像：`sha256:9accf2fac3e923b23f83bba7dbdc197b9bf5e05989d49734e234f7e9fd2f7f86`

## 剩余风险与服务器测试准入

1. 应用等待超时不会保证取消已下发给 Prisma/MySQL 的 SQL；超时后底层查询可能继续运行。服务器测试必须监控连接池、慢查询和数据库负载。
2. 本机通过 Windows PowerShell 驱动 Docker Linux 容器完成了完整隔离验收，但尚未用 Linux 主机脚本执行一次端到端隔离验收。三个 Linux 脚本语法已通过；完整 Linux 验收必须在生产部署前完成。
3. ESLint 仍有 511 条仓库既有 warning，本次门禁为 0 error；warning 治理不属于本次可信身份适配范围。
4. 本次只具备服务器测试准入，不具备生产部署准入。服务器测试必须使用隔离数据库和测试凭据；生产部署前仍需完成 Linux 端到端验收、备份、环境核对和回滚演练。
