export type ErpDashboardRoleView = "ADMIN" | "PURCHASE" | "WAREHOUSE";

export type DashboardSection<T> = { data: T; error?: never } | { data?: never; error: "统计数据暂时不可用" };

export type ErpDashboardResponse = {
  roleView: ErpDashboardRoleView;
  generatedAt: string;
  production?: DashboardSection<Record<string, unknown>>;
  kitCheck?: DashboardSection<Record<string, unknown>>;
  procurement?: DashboardSection<Record<string, unknown>>;
  inventory?: DashboardSection<Record<string, unknown>>;
  movements?: DashboardSection<Record<string, unknown>>;
  alerts?: DashboardSection<Record<string, unknown>>;
};
