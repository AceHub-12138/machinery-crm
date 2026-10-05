# DachuanPro 2.0 阶段 2：API 领域化实施记录

## 本阶段已实施

阶段 2 从 `codex/dachuanpro-v2.0-integration` 的阶段 0 文档基线派生；没有合入阶段 1 业务代码。

| 领域 | 服务 | 旧入口 | 新/推荐入口 | 本阶段兼容承诺 |
| --- | --- | --- | --- | --- |
| CRM 客户 | `src/modules/crm/customers/service.ts` | `/api/customers` | `/api/crm/customers` | GET/POST 共用服务；保留分页结构、权限 where、创建审计与重复提示 409 |
| ERP 库存 | `src/modules/erp/inventory/service.ts` | `/api/erp/inventory` | 保持原 URL | 保留筛选、预警阈值优先级和 `{items,pagination}` 响应 |
| SYSTEM 审计 | `src/modules/system/audit/service.ts` | `/api/operation-logs` | `/api/system/audit` | 两个 GET 均为既有数组形状、相同的超管服务层授权 |
| AGENT | `src/modules/agent/assertion.ts` | `/api/agent/assertion` | 保持原 URL | 保留 Session、仅超管、HS256、600 秒 TTL 和 `{token,expiresIn}` |

Route 仅处理 Session、HTTP 状态和 JSON response；查询、权限与业务校验进入服务。`DomainError` 是服务到 Route 的受控错误边界，避免兼容入口复制权限分支。

客户新旧入口已覆盖 401/403/200/409；审计新旧 GET 已覆盖 401/403/200。审计只读查询不存在自然的 404 或 409 业务语义，因此不人为制造该状态码。

## 数据与安全边界

- 无 Prisma schema、migration、SQL 或数据库连接变更。
- CRM 客户服务先拒绝 `PURCHASE`/`WAREHOUSE`，再由 `buildCustomerWhereClause(user)` 建立业务线、省市与软删范围，再附加浏览器筛选；筛选不能扩大权限。
- ERP 库存服务在查询前执行 ERP 角色校验；未改动任何入/出库写事务。
- 审计服务仍只允许超级管理员；分页、脱敏展示和对象级范围属于阶段 3，未假装已经完成。
- assertion 服务不写 token 日志，不新增 Gateway URL，也不让 Agent/MCP 直接访问 Prisma。

## API 注册与 MCP 候选

- `src/modules/agent/api-registry.ts` 是静态代码常量，只描述既有/推荐路由和服务归属，不从数据库加载可执行 URL。
- `src/modules/agent/mcp-tool-candidates.ts` 完整登记设计文档第一批的 9 个候选；全部为 `SUPER_ADMIN`、只读、LOW 风险，且拥有输入/输出 schema 名称、权限、数据范围及审计动作。
- 候选未注册为 HTTP 或 MCP Tool，`/api/agent/assertion` 不是 Tool。普通员工 Agent 身份桥接尚未获批，因此没有扩大授权。

## 后续迁移边界

合同、报价、发货、采购订单、库存写入、生产工单、用户管理和审计升级均保持原有稳定 Route/状态机。本阶段没有“批量改名”；后续每一族 API 迁移必须让旧/新 Route 调用同一服务，并补充 200/401/403/404/409 契约测试。
