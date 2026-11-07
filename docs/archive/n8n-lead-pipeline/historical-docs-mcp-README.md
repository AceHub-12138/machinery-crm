# DachuanPro CRM/ERP 统一只读 MCP

服务入口为 `POST https://mcp.dachuan.pro/api/mcp`，传输协议优先使用 Streamable HTTP。服务以现有 Next.js Route Handler 运行，查询只经过固定 Prisma 调用；没有 SQL、资源写入或审批类工具。

`MCP_TOOL_MODE=IDENTITY_POC` 只暴露 `dachuan_identity_who_am_i`；`MCP_TOOL_MODE=FULL_READ_ONLY` 暴露该身份工具和下列 24 个只读业务工具，共 25 个。模式只能在隔离验收或经准入的服务器测试环境切换，不能把隔离配置直接复制到生产。

`MCP_TOOL_MODE=LEAD_WRITE_INTERNAL` 是与上述目录隔离的内部写模式，只暴露 `lead_upsert`，只接受独立服务断言。N3 最小权限部署见 [Lead 写路径 N3 手动部署与回滚](LEAD_WRITE_N3_DEPLOYMENT.md)；N8N → FastGPT → N3 接入见 [N4 端到端部署与回滚](LEAD_E2E_N4_DEPLOYMENT.md)，评分契约见 [Lead 评分画像 Prompt v1](LEAD_SCORING_PROMPT_V1.md)。

## 工具目录

| 模块 | 工具 |
| --- | --- |
| AI 线索池 | `lead_list`、`lead_get`、`lead_stats` |
| 客户及跟进 | `crm_customers_list`、`crm_customer_get`、`crm_customer_follows_list` |
| 产品 | `crm_products_list`、`crm_product_get` |
| 合同 | `crm_contracts_list`、`crm_contract_get` |
| 发货 | `crm_shipments_list`、`crm_shipment_get` |
| 供应商 | `erp_suppliers_list`、`erp_supplier_get` |
| 采购订单 | `erp_purchase_orders_list`、`erp_purchase_order_get` |
| 库存及出入库 | `erp_inventory_list`、`erp_stock_documents_list`、`erp_stock_movements_list` |
| 整机用料清单 | `erp_boms_list`、`erp_bom_get` |
| 生产工单 | `erp_production_orders_list`、`erp_production_order_get` |
| 齐套检查 | `erp_kit_check` |

全部工具都声明 `readOnlyHint: true`、`destructiveHint: false`。分页默认 20、最大 100。工具参数由 Zod 固定校验，不接受字段表达式、SQL、模型名或自定义排序。

## 鉴权与数据范围

FastGPT 服务 Key 只标识调用服务，不绑定 `User.id`。CRM 内嵌 Gateway 根据现有登录 Session 签发 5～15 分钟 Ed25519 用户断言；MCP 同时校验服务 Key、断言和 requestId，并按断言 `sub` 每次重新读取数据库用户。禁用、角色或负责范围变化立即生效，令牌中的自报角色/区域不存在也不受信任。

- `SALES`、`FOREIGN_TRADE`：客户、跟进、合同和发货沿用业务线及省市负责范围。
- `SUPER_ADMIN`：沿用现有全局视图；BOM 详情和即时齐套检查仍仅管理员可用。
- AI 线索池三个工具仅允许 `SUPER_ADMIN`，第五批明确放开前其他角色一律拒绝。
- `PURCHASE`：数据库真实采购角色；按现有 GET 权限可查询供应商、采购订单、库存、出入库、库存流水、BOM 列表和生产工单；供应商详情可用，BOM 详情与即时齐套不可用。
- `WAREHOUSE`：数据库真实仓库角色；按现有 GET 权限可查询供应商列表、库存、出入库、库存流水、BOM 列表、生产工单及已提交/已批准采购订单；供应商详情、BOM 详情与即时齐套不可用。
- 产品沿用当前登录用户可查询的公共产品数据。

工具结果统一为：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "...",
    "tool": "crm_customers_list",
    "generatedAt": "2026-07-17T08:00:00.000Z"
  },
  "error": null
}
```

## API Key 生成

在源码目录执行：

```powershell
corepack pnpm mcp:keygen
```

把输出的 `KEY_HASH` 写入服务端 `MCP_API_KEYS_JSON`，把 `API_KEY` 仅写入 FastGPT。不要把明文 Key 提交到 Git、镜像或日志。

## FastGPT 4.15.1 接入

1. 对精确 FastGPT 4.15.1 源码应用 `deploy/fastgpt/v4.15.1` 补丁，并固定自定义镜像标签。
2. 在 FastGPT 的 MCP Server 配置中选择 HTTP/SSE，地址填写 `https://mcp.dachuan.pro/api/mcp`。
3. 固定请求头只填写 `Authorization: Bearer <MCP_SERVICE_KEY>`；不得静态配置用户断言。
4. CRM 内嵌入口请求 `/api/agent-gateway/chat`，Gateway 用专用 FastGPT Chat Key 调用 `/api/v1/chat/completions`。
5. PoC 先调用 `dachuan_identity_who_am_i`，确认响应、审计和当前 ERP 用户一致。

FastGPT 4.15.1 的实现会先尝试 Streamable HTTP；仅在特定 4xx 响应时回退旧 SSE，因此该地址无需另设 SSE 端点。反向代理需允许 POST，并保留 Authorization、`X-Dachuan-User-Assertion`、`X-Dachuan-Request-Id`、Host 和 `MCP-Protocol-Version`；访问日志不得记录两个身份头。

## 审计

每个 MCP 协议请求写入现有 `OperationLog`：`action=MCP_CALL`、`entityType=McpRequest`。只记录可信 ERP userId、requestId、服务 Key 名称、协议方法、工具名、成功状态、HTTP 状态、耗时和固定拒绝原因；不向审计层传递或落库工具参数、查询词、返回正文、断言或明文 API Key。无法从无效断言可信确定用户时，以 `MCP_AUDIT_USER_ID` 归属拒绝日志。已认证调用若审计写入失败，会返回 503 且不交付查询结果。

列表工具默认每页 20、最大 100，搜索词最长 100 字符；日期筛选必须同时提供起止日期且跨度不超过 366 天。库存预警查询最多构造 500 个候选物料条件，超过时安全拒绝并要求增加仓库或搜索条件。`MCP_QUERY_TIMEOUT_MS` 默认 5000，只限制应用等待时间。当前 Prisma/MySQL 接口不能保证取消已经下发的 SQL，超时后底层查询可能继续完成，这是部署前仍需监控连接池和慢查询的剩余风险。

## AI 线索池数据库双门禁

批次 02 部署必须同时完成两项，缺一不可：先执行 `20260814113000_add_ai_lead_pool/migration.sql` 建立 `leads`、`lead_feedback_events`，再给 MCP 查询账号授予这两张表的 `SELECT`。migration 不硬编码生产数据库名或账号 Host；生产操作前先执行 `SELECT User, Host FROM mysql.user WHERE User = 'dachuan_mcp_read';`，确认实际数据库名和 Host 后再逐表 `GRANT SELECT`，最后使用 `SHOW GRANTS` 和该只读账号各执行一次只读查询。不得给该账号授予 INSERT、UPDATE、DELETE 或整库权限。

N3 写实例另需 `lead_write_audits` 与 `lead_write_idempotencies`。企业去重只使用 companyName 的 NFKC、小写及去空格/标点/符号结果，不做模糊匹配；同企业新幂等键合并原 Lead 并保留独立回执。新建 Lead 只从 profile 中经过标准省市校验的 `province/city` 读取可信地域：国内销售复用 CRM 用户 `territories` 唯一匹配，`国外` 使用现有 FOREIGN_TRADE 角色唯一匹配；缺失、零匹配或多匹配均保持未指派。查询账号仍完全只读；独立写账号除批准 Lead 列的 column-level UPDATE 外，只增加 `users(id,role,territories,isActive)` 列级 SELECT，不得读取密码、更新销售分配或写其他业务表。

批次 02 代码回滚使用 `git revert`。其数据库回滚脚本只针对 `leads`、`lead_feedback_events` 两张基础表，会删除其中全部线索数据，禁止在未备份的生产库直接执行。N3 公司级合并修正的普通代码回滚应保留 additive `lead_write_idempotencies` 回执表；该 migration 目录的 `rollback.sql` 会丢失新增回执，只允许在确认没有修正版本写入、或已经单独备份回执后执行。

身份架构和威胁模型见 [IDENTITY_POC.md](./IDENTITY_POC.md) 与 [IDENTITY_THREAT_MODEL.md](./IDENTITY_THREAT_MODEL.md)。部署和回滚见 [DEPLOYMENT.md](./DEPLOYMENT.md)，验证证据见 [IDENTITY_POC_TEST_REPORT.md](./IDENTITY_POC_TEST_REPORT.md)。
