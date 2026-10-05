# DachuanPro 2.0 API 与 URL 兼容策略

## 不可破坏的入口

| 现有入口 | 当前消费者/行为 | 2.0 兼容策略 |
| --- | --- | --- |
| `/` | 当前无条件跳 `/dashboard` | 改为服务端读取 Session 后按角色整页跳转；无 Session 仍为 `/login` |
| `/dashboard` | 当前 CRM 工作台、地图和筛选 | 永久作为 CRM 兼容入口，优先整页跳转至 `/dashboard/crm` 或导出同一页面；不得删除地图 |
| `/api/dashboard` | 当前 CRM Dashboard 页面、提醒页 | 保持请求/响应字段与数据范围；新增 `/api/crm/dashboard` 调同一服务 |
| `/erp/**` | 已上线 ERP 页面、历史收藏与桌面入口 | 保留全部现有 URL；新导航只改变菜单信息架构 |
| `/api/erp/**` | 现有 ERP 页面与任务接口 | 保留方法、状态码、字段和状态机；抽服务后新旧 Route 同调 |
| `/api/customers?search=&pageSize=50` | 合同客户搜索的指定调用方式 | 不改为全量下拉；CRM 新路径可并行提供同一查询语义 |
| `/api/agent/assertion` | 桌宠/Gateway 身份桥接 | 保持 POST、登录/超管判断、HS256、短 TTL 和无敏感值日志 |
| `NEXT_PUBLIC_AGENT_GATEWAY_URL`、`NEXT_PUBLIC_AGENT_APP_ID` | standalone 构建期内联变量 | 保持 GitHub Actions job `env` 显式映射；不得在运行时返回原值 |
| `/api/auth/[...nextauth]` | 登录、Session、CSRF | 不重命名、不替换 session 策略、不绕过 middleware |

## URL 迁移与页面兼容

- 新增 `/dashboard/crm` 与 `/dashboard/erp`；`/dashboard` 保留 CRM 兼容。
- 新增 `/tasks`，但不删除现有合同解锁、合同删除、工单变更审批页；先将它们作为统一待办的 `href`。
- 新增 `/admin/master-data`、`/admin/config`、`/admin/health`、`/admin/cockpit`；只对 `SUPER_ADMIN` 注册菜单和后端访问。
- 现有 `/settings` 不可直接重定义为配置中心：它目前显示版本与变更记录且可被采购/仓库 middleware 放行。2.0 配置中心只能新增 `/admin/config`。

## 驾驶舱访问矩阵

| 角色 | `/dashboard` 与 `/dashboard/crm` | `/dashboard/erp` | `/api/dashboard` 与 `/api/crm/dashboard` | `/api/erp/dashboard` |
| --- | --- | --- | --- | --- |
| 未登录 | 跳 `/login` | 跳 `/login` | 401 | 401 |
| `SUPER_ADMIN` | 允许，全局 CRM | 允许，全局 ERP | 200，全局范围 | 200，完整角色视图 |
| `SALES` | 允许，国内销售权限范围 | 安全跳回 CRM | 200，CRM 范围 | 403 |
| `FOREIGN_TRADE` | 允许，外贸权限范围 | 安全跳回 CRM | 200，CRM 范围 | 403 |
| `PURCHASE` | 安全跳回 ERP | 允许，采购视图 | 403 | 200，采购裁剪结构 |
| `WAREHOUSE` | 安全跳回 ERP | 允许，仓库视图 | 403 | 200，仓库裁剪结构 |

页面跳转不是 API 授权替代。CRM 的所有 KPI、地图、路径、下拉选项和列表必须来自同一受限 service；ERP service 必须在查询前选择角色数据集，禁止先查全局 CRM 机密数据再前端隐藏。

## API 契约要求

1. 旧 URL 和推荐新 URL 共享服务和 schema；禁止复制两份业务规则。
2. 对每个已迁移接口建立参数化契约测试：成功、未登录 401、越权 403、缺失 404、业务冲突 409。
3. 写接口保留既有审计动作，并在服务层统一追加脱敏；不能让兼容 Route 绕过日志。
4. API 注册表只记录事实与策略，不作为普通管理员可编辑的路由开关。
5. 旧 ERP API 的现有状态名（如采购订单 `DRAFT/ORDERED/PARTIAL_RECEIVED/RECEIVED/CANCELLED`）在对应业务迁移完成前不得更名。

## 接口族兼容矩阵

| 接口族 | 方法/认证 | 保留输入与返回 | 迁移验收 |
| --- | --- | --- | --- |
| CRM 列表 | GET；Session；客户范围 | `search`、分页/筛选及现有数组或 `{items,pagination}` 形状不变 | 同用户、同参数，新旧 URL 内容与 401/403 一致 |
| CRM 写入/审批 | POST/PUT/DELETE；Session+对象权限 | 现有审批状态、错误字段 `{error}` 与 409 业务冲突不变 | 合同锁定、删除申请、回款重算与审计一致 |
| ERP 查询 | GET；Session+ERP角色 | `search`、状态、`page/pageSize` 与库存/采购/工单当前字段不变 | 五角色执行允许/拒绝矩阵，比较分页与字段 |
| ERP 库存写入 | POST/PUT/DELETE；服务层角色+事务 | 单据/流水快照、400 校验、409 并发/冲突语义不变 | 入/出/盘/调的库存、流水、齐套队列和日志一致 |
| ERP 生产采购写入 | POST/PATCH；角色+状态机 | 工单、齐套、需求、订单及交期状态不变 | 生产→齐套→需求→采购与审批路径一致 |
| Agent assertion | POST；Session+SUPER_ADMIN | `{token,expiresIn}`、401/403/503 和 600 秒语义不变 | 无 Agent 配置、非超管、超管三组回归；不记录 token |
| System/审计 | GET/写入；超管或对象范围 | 旧 `/api/users` 与 `/api/operation-logs` 不变；新系统路径并行 | 新旧返回、分页、脱敏及 403 一致 |

## 需特别防护的兼容风险

- 登录修复必须使用整页导航，并验证 CSRF/Session Cookie 已写入；不能以关闭 middleware 或降低 NextAuth 安全配置“修复”。
- sidebar 重组不能改变移动端关闭逻辑，不能用全局页面滚动恢复替代 sidebar 内部滚动恢复。
- Agent 只能调用被注册、允许、具备数据范围判断的服务；2.0 的新写、删除、配置和健康管理 API 默认 `agentExposable: false`。
- 旧 `OperationLog` 的 JSON 历史可能含敏感键名；新增展示层必须脱敏，但不得改写历史原始记录。
