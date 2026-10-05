export type ApiRegistryEntry = {
  domain: "CRM" | "ERP" | "SYSTEM" | "AGENT";
  legacyPaths: readonly string[];
  recommendedPath?: string;
  service: string;
  agentExposable: boolean;
  note: string;
};

/** 代码常量而非数据库配置，不能被管理员改成任意可执行 URL。 */
export const API_REGISTRY: readonly ApiRegistryEntry[] = [
  { domain: "CRM", legacyPaths: ["/api/customers"], recommendedPath: "/api/crm/customers", service: "modules/crm/customers/service", agentExposable: false, note: "客户数据范围由 SessionUser 决定" },
  { domain: "CRM", legacyPaths: ["/api/contracts/**"], recommendedPath: "/api/crm/contracts/**", service: "modules/crm/contracts", agentExposable: false, note: "稳定写状态机暂不批量迁移" },
  { domain: "CRM", legacyPaths: ["/api/customer-quotes/**"], recommendedPath: "/api/crm/customer-quotes/**", service: "modules/crm/contracts", agentExposable: false, note: "报价转合同属于高风险写操作" },
  { domain: "CRM", legacyPaths: ["/api/shipments/**", "/api/follows", "/api/dashboard"], recommendedPath: "/api/crm/shipments/**", service: "modules/crm/shipments", agentExposable: false, note: "发货、跟进和驾驶舱保留兼容入口" },
  { domain: "CRM", legacyPaths: ["/api/products/**"], recommendedPath: "/api/crm/products/**", service: "modules/crm/products", agentExposable: false, note: "产品同时服务 CRM 与 ERP BOM" },
  { domain: "ERP", legacyPaths: ["/api/erp/materials/**", "/api/erp/material-categories/**", "/api/erp/warehouses/**", "/api/erp/products"], service: "modules/erp/inventory", agentExposable: false, note: "ERP URL 保持不变" },
  { domain: "ERP", legacyPaths: ["/api/erp/inventory"], service: "modules/erp/inventory/service", agentExposable: false, note: "保持 ERP URL" },
  { domain: "ERP", legacyPaths: ["/api/erp/stock-in/**", "/api/erp/stock-out/**", "/api/erp/stock-checks/**", "/api/erp/stock-transfers/**", "/api/erp/stock-movements"], service: "modules/erp/inventory", agentExposable: false, note: "库存写操作继续保留事务" },
  { domain: "ERP", legacyPaths: ["/api/erp/purchase-demands/**", "/api/erp/purchase-orders/**", "/api/erp/suppliers/**", "/api/erp/supplier-deliveries/**"], service: "modules/erp/purchase", agentExposable: false, note: "稳定采购状态机暂不批量迁移" },
  { domain: "ERP", legacyPaths: ["/api/erp/production-orders/**", "/api/erp/production-order-change-requests/**", "/api/erp/kit-check-results", "/api/erp/monthly-production-plans/**"], service: "modules/erp/production", agentExposable: false, note: "工单和齐套状态机不由待办层改写" },
  { domain: "ERP", legacyPaths: ["/api/erp/attachments/**"], service: "modules/erp/attachments", agentExposable: false, note: "保留文件类型、大小与实体权限校验" },
  { domain: "SYSTEM", legacyPaths: ["/api/operation-logs"], recommendedPath: "/api/system/audit", service: "modules/system/audit/service", agentExposable: false, note: "仅超级管理员，阶段 3 扩展筛选和脱敏展示" },
  { domain: "SYSTEM", legacyPaths: ["/api/users/**"], recommendedPath: "/api/system/users/**", service: "modules/system/users", agentExposable: false, note: "阶段 3 迁移" },
  { domain: "SYSTEM", legacyPaths: [], recommendedPath: "/api/system/{tasks,permissions,settings,health}", service: "modules/system/*", agentExposable: false, note: "阶段 3 新增；不暴露密钥或运行控制" },
  { domain: "AGENT", legacyPaths: ["/api/agent/assertion"], service: "modules/agent/assertion", agentExposable: false, note: "仅签发短期身份桥接令牌，不是 MCP Tool" },
];
