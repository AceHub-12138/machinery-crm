import { canViewERP } from "@/lib/erp-roles";

export type NavIndexItem = {
  href: string;
  label: string;
  roles?: string[];
  group: string;
  adminOnly?: boolean;
  erpOnly?: boolean;
};

const CRM_ROLES = ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"];
const ERP_ROLES = ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"];

const NAV_ITEMS: NavIndexItem[] = [
  { href: "/dashboard/crm", label: "工作台", group: "导航" },
  { href: "/dashboard/crm", label: "CRM工作台", roles: CRM_ROLES, group: "导航" },
  { href: "/dashboard/erp", label: "ERP工作台", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/tasks", label: "我的工作", group: "导航" },

  { href: "/customers", label: "客户与销售", roles: CRM_ROLES, group: "导航" },
  { href: "/customers", label: "客户管理", roles: CRM_ROLES, group: "导航" },
  { href: "/reminders", label: "跟进提醒", roles: CRM_ROLES, group: "导航" },
  { href: "/contracts", label: "合同管理", roles: CRM_ROLES, group: "导航" },
  { href: "/shipments", label: "发货管理", roles: CRM_ROLES, group: "导航" },
  { href: "/after-sales", label: "售后调试", roles: CRM_ROLES, group: "导航" },
  { href: "/products", label: "产品库", roles: CRM_ROLES, group: "导航" },

  { href: "/erp/purchase-demands", label: "采购与供应", group: "导航", erpOnly: true },
  { href: "/erp/purchase-demands", label: "采购需求", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/erp/purchase-orders", label: "采购订单", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/erp/suppliers", label: "供应商管理", roles: ["SUPER_ADMIN", "PURCHASE"], group: "导航", erpOnly: true },
  { href: "/erp/supplier-deliveries", label: "供应商交期跟踪", roles: ERP_ROLES, group: "导航", erpOnly: true },

  { href: "/erp/inventory", label: "库存与物料", group: "导航", erpOnly: true },
  { href: "/erp/inventory", label: "库存台账", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/erp/stock-in", label: "入库", roles: ["SUPER_ADMIN", "WAREHOUSE"], group: "导航", erpOnly: true },
  { href: "/erp/stock-out", label: "出库", roles: ["SUPER_ADMIN", "WAREHOUSE"], group: "导航", erpOnly: true },
  { href: "/erp/stock-transfers", label: "库存调拨", roles: ["SUPER_ADMIN", "WAREHOUSE"], group: "导航", erpOnly: true },
  { href: "/erp/stock-check", label: "盘点", roles: ["SUPER_ADMIN", "WAREHOUSE"], group: "导航", erpOnly: true },
  { href: "/erp/materials", label: "物料管理", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/erp/bom", label: "整机用料清单", roles: ["SUPER_ADMIN", "WAREHOUSE"], group: "导航", erpOnly: true },
  { href: "/erp/warehouse", label: "仓库管理", roles: ["SUPER_ADMIN", "WAREHOUSE"], group: "导航", erpOnly: true },

  { href: "/erp/production-orders", label: "生产执行", group: "导航", erpOnly: true },
  { href: "/erp/production-orders", label: "生产工单", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/erp/kit-check-results", label: "齐套检查", roles: ERP_ROLES, group: "导航", erpOnly: true },
  { href: "/erp/monthly-production-plans", label: "月度生产计划", roles: ERP_ROLES, group: "导航", erpOnly: true },

  { href: "/admin/cockpit", label: "平台管理", group: "导航", adminOnly: true },
  { href: "/admin/cockpit", label: "管理员工作台", group: "导航", adminOnly: true },
  { href: "/admin/master-data", label: "基础资料中心", group: "导航", adminOnly: true },
  { href: "/users", label: "用户与权限", group: "导航", adminOnly: true },
  { href: "/admin/config", label: "配置中心", group: "导航", adminOnly: true },
  { href: "/operation-logs", label: "操作日志", group: "导航", adminOnly: true },
  { href: "/admin/health", label: "系统健康", group: "导航", adminOnly: true },
];

export function getAllNavItems(): NavIndexItem[] {
  return [...NAV_ITEMS];
}

export function filterNavForRole(
  items: NavIndexItem[],
  role: string,
): NavIndexItem[] {
  return items.filter((item) => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (role === "WAREHOUSE" || role === "PURCHASE") {
      return item.erpOnly === true || item.href === "/dashboard/crm";
    }
    if (item.adminOnly && role !== "SUPER_ADMIN") return false;
    if (item.erpOnly && !canViewERP(role)) return false;
    return true;
  });
}
