# DachuanPro 2.0 MCP Tool 候选与禁区

## 强制安全模型

MCP Tool 不直接连接 Prisma 或 MySQL。它只能通过受控 Agent API/领域服务，携带经身份桥接验证的用户身份，并在每一次调用执行角色、权限动作和数据范围校验。当前 `/api/agent/assertion` 仅为 `SUPER_ADMIN` 签发短期 HS256 token；在另有经过审查的用户身份桥接之前，不得把它扩大解释为普通角色的 Agent 授权。

每个登记项必须包含 `toolName`、`domain`、`serviceAction`、`inputSchema`、`outputSchema`、`requiredPermission`、`allowedRoles`、`dataScope`、`readOnly`、`riskLevel` 与 `auditAction`。

阶段 2 已在 `src/modules/agent/mcp-tool-candidates.ts` 以静态 TypeScript 常量落地候选字段校验；这不是已开放的 MCP Tool，也没有新增 Gateway 或数据库直连能力。

## 第一批候选（只读、可审计）

| Tool 候选 | 服务动作 | 允许角色与数据范围 | 风险 |
| --- | --- | --- | --- |
| `crm_customers_list` | 客户搜索/列表 | 当前仅 SUPER_ADMIN；未来经角色身份桥接后 SALES/FOREIGN_TRADE 为业务线+省市+负责人 | LOW |
| `crm_customer_get` | 客户详情摘要 | 当前仅 SUPER_ADMIN；未来角色桥接须以 `canAccessCustomer` 复核 ID | LOW |
| `crm_contracts_list` | 合同列表/交期摘要 | 当前仅 SUPER_ADMIN；未来采用 CRM 数据范围 | LOW |
| `crm_shipments_list` | 发货查询 | 当前仅 SUPER_ADMIN；未来采用 CRM 数据范围 | LOW |
| `erp_inventory_list` | 库存查询 | 当前仅 SUPER_ADMIN；未来 PURCHASE/WAREHOUSE 仅已授权库存范围 | LOW |
| `erp_purchase_orders_list` | 采购订单与交期风险查询 | 当前仅 SUPER_ADMIN；未来 SUPER_ADMIN/PURCHASE/允许范围内 WAREHOUSE | LOW |
| `erp_production_orders_list` | 工单、交期和齐套摘要 | 当前仅 SUPER_ADMIN；未来按经审查服务范围 | LOW |
| `erp_kit_check_get` | 齐套结果摘要 | 当前仅 SUPER_ADMIN；未来按生产工单范围并过滤软删 | LOW |
| `system_tasks_list` | 当前用户统一待办 | 当前仅 SUPER_ADMIN；未来仅 assignee/initiator，超管全局 | LOW |

所有候选应分页、限字段、限数量，并返回对用户可见的业务摘要；不将人员、令牌、附件存储路径或未脱敏日志作为工具输出。

## 默认禁止开放

- 用户、角色、权限、系统配置、编号规则、健康检查详情、环境变量状态以外的任何运行配置；
- 采购/齐套删除审批、入库作废、库存调整、发货、回款、合同写入、工单状态变更；
- 上传、下载任意文件、数据库查询、SQL、部署、Nginx、PM2、Docker、Shell；
- `/api/auth/**`、`/api/agent/assertion` 的签发功能、cron/process 端点；
- 包含 `password`、`passwordHash`、`token`、`cookie`、`authorization`、`apiKey`、`secret`、`privateKey`、`DATABASE_URL`、`connectionString` 的任何原始字段。

## 将来写操作的门槛

写 Tool 不是 2.0 默认范围。若将来单独批准，必须新增：用户明确确认、幂等键、服务层状态机、Serializable/合适事务、对象级权限、完整脱敏审计、失败不重试副作用和人工审批边界。入库作废及系统管理类接口永久不作为普通 Agent Tool 候选。
