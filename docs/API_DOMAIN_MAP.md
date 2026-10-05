# DachuanPro 2.0 API 领域盘点

审计基线：`adfc3bd`。当前共有 94 个 `src/app/api/**/route.ts`。下表按业务领域归类；“推荐路径”是渐进式目标，旧路径在阶段 2 前后必须继续可用。完整 path/method 清单见文末附录。

| 当前 API 组 | 当前路径 | 推荐领域路径 | 服务归属 | 现状/边界 |
| --- | --- | --- | --- | --- |
| CRM 客户 | `/api/customers`、`/{id}`、`/{id}/contracts`、`/{id}/quotes` | `/api/crm/customers/**` | `modules/crm/customers` | 已有 CRM 数据范围；搜索接口可复用 `search` 与 `pageSize=50` |
| CRM 合同与回款 | `/api/contracts/**`、`/api/contract-unlock-requests/**`、`/api/contract-delete-requests/**` | `/api/crm/contracts/**` | `modules/crm/contracts` | 保留合同锁定、审批与回款状态重算 |
| CRM 报价 | `/api/customer-quotes/**` | `/api/crm/customer-quotes/**` | `modules/crm/contracts` | 报价转合同为写操作，不能给 MCP 默认开放 |
| CRM 发货与跟进 | `/api/shipments/**`、`/api/follows`、`/api/dashboard` | `/api/crm/shipments/**`、`/api/crm/follows`、`/api/crm/dashboard` | `modules/crm/shipments`、`dashboard` | `/api/dashboard` 是当前 CRM 工作台；保留全国发货路径查询口径 |
| CRM 产品 | `/api/products/**` | `/api/crm/products/**` | `modules/crm/products` | 产品同时服务 CRM 合同与 ERP BOM，迁移时不复制数据 |
| ERP 主数据 | `/api/erp/materials/**`、`material-categories/**`、`warehouses/**`、`products`、`production-users` | 保持 `/api/erp/**`，服务落 `modules/erp/{inventory,production}` | `modules/erp/*` | 已有 ERP 路径符合目标；只抽服务，不批量改 URL |
| ERP 库存 | `/api/erp/inventory`、`stock-in/**`、`stock-out/**`、`stock-checks/**`、`stock-transfers/**`、`stock-movements` | 保持 `/api/erp/**` | `modules/erp/{inventory,stock-in,stock-out,stock-check,stock-transfer}` | 所有库存写入继续事务化；阶段 5 独立处理作废 |
| ERP 采购与供应 | `/api/erp/purchase-demands/**`、`purchase-orders/**`、`suppliers/**`、`supplier-deliveries/**`、`procurement-config`、`delivery-reminders/run` | 保持 `/api/erp/**` | `modules/erp/{purchase,suppliers}` | 采购需求与订单、交期批次和提醒已有模型；cron 端点须保留独立认证 |
| ERP 生产与齐套 | `/api/erp/production-orders/**`、`production-order-change-requests/**`、`kit-check-results`、`kit-rechecks/process`、`monthly-production-plans/**`、`monthly-spare-parts-forecasts` | 保持 `/api/erp/**` | `modules/erp/{production,kit-check}` | 工单变更、齐套重检和月度计划已有状态机，不能在待办层重写 |
| ERP 附件 | `/api/erp/attachments/**` | `/api/erp/attachments/**` | `modules/erp/attachments` | 保持实体、角色、文件类型与大小校验 |
| 系统用户 | `/api/users/**` | `/api/system/users/**` | `modules/system/users` | 旧 API 继续服务现有前端；只有超管可管理 |
| 系统审计 | `/api/operation-logs` | `/api/system/audit` | `modules/system/audit` | 当前只有 action/entityType 筛选；2.0 增加分页、脱敏与对象范围 |
| 系统待办/配置/健康 | 当前无统一 API；`/api/erp/procurement-config` 为单项配置 | `/api/system/{tasks,permissions,settings,health}` | `modules/system/*` | 新增 API，不把系统密钥和运行控制开放给前端 |
| Agent | `/api/agent/assertion` | 保留；代码内 `api-registry.ts`（不新开对外 Registry API） | `modules/agent/{registry,policies}` | assertion 只为已登录超管签发短期 token；不提供数据库能力 |
| 文件与地图 | `/api/upload/**`、`/api/uploads/**`、`/api/map/**` | 保持兼容；按实际服务归属 | existing services | 上传和地图代理不是通用开放 API，权限和外部 Key 保护不可弱化 |
| 认证 | `/api/auth/[...nextauth]` | 保持 | `lib/auth.ts` | NextAuth 内部端点，不进入业务注册表 |

## Route 到服务的迁移规则

1. Route 仅做 session、参数 schema、HTTP status 和 response；业务查询、状态转换、事务与审计放入相应 `service.ts`。
2. Repository 仅封装 Prisma 查询；权限函数接受已加载的 `SessionUser`，保持现有 DB 刷新的身份来源。
3. 旧 Route 与新 Route 必须调用同一个服务，并以契约测试比较正常、401、403、404、409 响应。
4. 路由登记采用代码常量，不从数据库读取任意可执行 path。
5. 所有读接口要明确数据范围：CRM 为业务线/省市/负责人；ERP 为角色和已定义的业务归属；SYSTEM 默认超级管理员。

## 阶段 2 已落地的渐进迁移

- `/api/customers` 与 `/api/crm/customers` 共同调用 `modules/crm/customers/service.ts`；保留分页、创建审计与 CRM 数据范围。
- `/api/erp/inventory` 保持 URL，不批量改名，已抽到 `modules/erp/inventory/service.ts`。
- `/api/operation-logs` 与 `/api/system/audit` 共同调用 `modules/system/audit/service.ts`；仍保持当前数组响应，完整分页与脱敏展示留给阶段 3。
- `/api/agent/assertion` 已抽为 `modules/agent/assertion.ts`，但 URL、HS256、600 秒 TTL 和超管限制不变。
- 静态 API 注册表位于 `modules/agent/api-registry.ts`；它不接受数据库编辑，也不会生成对外动态 Route。

## 阶段 3 系统领域增量

- `/api/system/tasks` 聚合既有审批/需求来源，并只保存用户视图状态，不复制或替代业务审批状态。
- `/api/system/settings`、`/api/system/permissions`、`/api/system/health` 均在 Route 和服务层限制为超级管理员；设置键采用白名单。
- `/api/system/audit/search` 是新的分页脱敏查询；`/api/operation-logs` 与 `/api/system/audit` 保持原有数组响应兼容。

## 当前权限盘点

- `SUPER_ADMIN`：当前可进入 CRM、ERP、用户、日志和设置；2.0 仍是全权限基线。
- `SALES`、`FOREIGN_TRADE`：当前 CRM 查询通过 `customerIsolationWhere()` 以业务线和 `territories` 限制；middleware 禁止 ERP 页面/API。
- `PURCHASE`：当前可进入有限 ERP 页面与 `/settings`；采购/供应商写权限由 `canManagePurchaseOrders`、`canManageSuppliers` 控制。
- `WAREHOUSE`：当前可进入有限 ERP 页面与 `/settings`；库存写权限由 `canManageInventory` 控制。

这些是迁移前安全兜底，不代表已完成 2.0 的 `VIEW/CREATE/UPDATE/DELETE/REQUEST_DELETE/APPROVE/PRINT/EXPORT/CONFIGURE/VIEW_AUDIT` 矩阵。

## 阶段 1 驾驶舱服务归属

| API | Route 只负责 | 服务负责 | 权限与查询 |
| --- | --- | --- | --- |
| `/api/dashboard`、`/api/crm/dashboard` | 新鲜 `SessionUser`、参数解析、HTTP response | `modules/crm/dashboard/service.ts` | 仅 CRM 三角色；固定权限 where 与筛选 where 相交；地图、KPI、下拉与列表共享 scope |
| `/api/erp/dashboard` | 新鲜 `SessionUser`、参数解析、HTTP response | `modules/erp/dashboard/service.ts` | 仅超管/采购/仓库；`permissions.ts` 在每段查询前裁剪，`types.ts` 不暴露 CRM 敏感字段 |

## 附录：当前 API path/method 清单（归档级）

| 领域 | 方法 | Path |
| --- | --- | --- |
| Agent/Auth | POST | `/api/agent/assertion` |
| Agent/Auth | NextAuth | `/api/auth/[...nextauth]` |
| CRM | GET,POST | `/api/customers`、`/api/contracts`、`/api/follows`、`/api/shipments` |
| CRM | GET,PUT,DELETE | `/api/customers/{id}`、`/api/contracts/{id}` |
| CRM | GET | `/api/customers/{id}/contracts`、`/api/customers/{id}/quotes`、`/api/dashboard` |
| CRM | GET,POST | `/api/contracts/{id}/payments` |
| CRM | PUT,DELETE | `/api/contracts/{id}/payments/{paymentId}` |
| CRM | GET,POST | `/api/customer-quotes` |
| CRM | GET | `/api/customer-quotes/{id}`、`/api/customer-quotes/{id}/contract` |
| CRM | POST | `/api/customer-quotes/{id}/update-contract`、`/api/contract-unlock-requests`、`/api/contract-delete-requests`、`/api/contract-unlock-requests/{id}/{approve,reject}`、`/api/contract-delete-requests/{id}/{approve,reject}` |
| CRM | GET | `/api/contract-unlock-requests`、`/api/contract-delete-requests` |
| CRM 产品 | GET,POST | `/api/products` |
| CRM 产品 | GET,PUT,DELETE | `/api/products/{id}` |
| ERP 主数据 | GET,POST | `/api/erp/materials`、`/api/erp/boms`、`/api/erp/suppliers`、`/api/erp/warehouses` |
| ERP 主数据 | GET,PUT,DELETE | `/api/erp/materials/{id}`、`/api/erp/boms/{id}`、`/api/erp/suppliers/{id}` |
| ERP 主数据 | PATCH | `/api/erp/material-categories/{id}` |
| ERP 主数据 | GET | `/api/erp/material-categories`、`/api/erp/products`、`/api/erp/production-users`、`/api/erp/suppliers/{id}/delivery-performance` |
| ERP 主数据 | POST | `/api/erp/materials/import` |
| ERP 库存 | GET,POST | `/api/erp/stock-in`、`/api/erp/stock-out`、`/api/erp/stock-checks`、`/api/erp/stock-transfers` |
| ERP 库存 | GET | `/api/erp/stock-in/{id}`、`/api/erp/stock-out/{id}`、`/api/erp/inventory`、`/api/erp/stock-movements` |
| ERP 库存 | GET,PUT,DELETE | `/api/erp/stock-checks/{id}` |
| ERP 库存 | POST | `/api/erp/stock-in/{id}/unlink-purchase` |
| ERP 采购 | GET,POST | `/api/erp/purchase-demands`、`/api/erp/purchase-orders` |
| ERP 采购 | PATCH | `/api/erp/purchase-demands/{id}` |
| ERP 采购 | GET,PUT,DELETE | `/api/erp/purchase-orders/{id}` |
| ERP 采购 | POST | `/api/erp/purchase-demands/convert`、`/api/erp/purchase-orders/{id}/status`、`/api/erp/delivery-reminders/run` |
| ERP 采购 | GET | `/api/erp/supplier-deliveries` |
| ERP 采购 | PATCH | `/api/erp/supplier-deliveries/{itemId}` |
| ERP 采购 | POST | `/api/erp/supplier-deliveries/{itemId}/{batches,follow-ups,promise-date}` |
| ERP 生产 | GET,POST | `/api/erp/production-orders`、`/api/erp/monthly-production-plans` |
| ERP 生产 | GET,PUT,DELETE | `/api/erp/production-orders/{id}` |
| ERP 生产 | POST | `/api/erp/production-orders/from-contract`、`/api/erp/production-orders/{id}/{issue,kit-check,purchase-demands,status,change-requests}` |
| ERP 生产 | GET | `/api/erp/production-order-change-requests`、`/api/erp/kit-check-results` |
| ERP 生产 | POST | `/api/erp/production-order-change-requests/{id}/{approve,reject}`、`/api/erp/kit-rechecks/process`、`/api/erp/monthly-production-plans/{id}/{approve,convert}`、`/api/erp/monthly-spare-parts-forecasts` |
| ERP 生产 | GET,PUT | `/api/erp/monthly-production-plans/{id}` |
| ERP 配置/附件 | GET,PUT | `/api/erp/procurement-config` |
| ERP 配置/附件 | GET,POST | `/api/erp/attachments` |
| ERP 配置/附件 | DELETE | `/api/erp/attachments/{id}` |
| System | GET,POST | `/api/users` |
| System | GET,PUT,DELETE | `/api/users/{id}` |
| System | GET | `/api/users/active`、`/api/operation-logs` |
| Infra | POST | `/api/upload/{contracts,products,shipments}`、`/api/map/geocode` |
| Infra | GET | `/api/uploads/[...path]`、`/api/map/tile` |
