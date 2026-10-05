export type McpToolCandidate = {
  toolName: string;
  domain: "CRM" | "ERP" | "SYSTEM";
  serviceAction: string;
  inputSchema: string;
  outputSchema: string;
  requiredPermission: string;
  allowedRoles: readonly ["SUPER_ADMIN"];
  dataScope: string;
  readOnly: true;
  riskLevel: "LOW";
  auditAction: string;
};

/**
 * 候选清单不是 HTTP/MCP 路由，更不是数据库配置。
 * 只有完成身份桥接、领域服务和单独审查后，Gateway 才能登记其中的只读工具。
 */
export const MCP_TOOL_CANDIDATES: readonly McpToolCandidate[] = [
  { toolName: "crm_customers_list", domain: "CRM", serviceAction: "customers.list", inputSchema: "CustomerListQuery", outputSchema: "CustomerListSummary", requiredPermission: "CRM_CUSTOMER.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须复用 CRM 业务线、省市、负责人范围", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_CRM_CUSTOMERS" },
  { toolName: "crm_customer_get", domain: "CRM", serviceAction: "customers.get", inputSchema: "CustomerId", outputSchema: "CustomerSummary", requiredPermission: "CRM_CUSTOMER.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须对客户 ID 重做对象范围校验", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_CRM_CUSTOMER" },
  { toolName: "crm_contracts_list", domain: "CRM", serviceAction: "contracts.list", inputSchema: "ContractListQuery", outputSchema: "ContractListSummary", requiredPermission: "CRM_CONTRACT.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须复用 CRM 数据范围", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_CRM_CONTRACTS" },
  { toolName: "crm_shipments_list", domain: "CRM", serviceAction: "shipments.list", inputSchema: "ShipmentListQuery", outputSchema: "ShipmentListSummary", requiredPermission: "CRM_SHIPMENT.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须复用 CRM 数据范围", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_CRM_SHIPMENTS" },
  { toolName: "erp_inventory_list", domain: "ERP", serviceAction: "inventory.list", inputSchema: "InventoryListQuery", outputSchema: "InventorySummary", requiredPermission: "ERP_INVENTORY.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须复用 ERP 角色范围", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_ERP_INVENTORY" },
  { toolName: "erp_purchase_orders_list", domain: "ERP", serviceAction: "purchaseOrders.list", inputSchema: "PurchaseOrderListQuery", outputSchema: "PurchaseOrderSummary", requiredPermission: "ERP_PURCHASE.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须复用采购职责范围", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_ERP_PURCHASE_ORDERS" },
  { toolName: "erp_production_orders_list", domain: "ERP", serviceAction: "productionOrders.list", inputSchema: "ProductionOrderListQuery", outputSchema: "ProductionOrderSummary", requiredPermission: "ERP_PRODUCTION.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须复用生产业务范围", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_ERP_PRODUCTION_ORDERS" },
  { toolName: "erp_kit_check_get", domain: "ERP", serviceAction: "kitCheck.get", inputSchema: "KitCheckId", outputSchema: "KitCheckSummary", requiredPermission: "ERP_KIT_CHECK.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "全公司；未来必须过滤软删除结果", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_ERP_KIT_CHECK" },
  { toolName: "system_tasks_list", domain: "SYSTEM", serviceAction: "tasks.listForUser", inputSchema: "TaskListQuery", outputSchema: "UnifiedTaskList", requiredPermission: "SYSTEM_TASK.VIEW", allowedRoles: ["SUPER_ADMIN"], dataScope: "当前用户；阶段 3 待办聚合完成后才可实现", readOnly: true, riskLevel: "LOW", auditAction: "MCP_READ_SYSTEM_TASKS" },
];
