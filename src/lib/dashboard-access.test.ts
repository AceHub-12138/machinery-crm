import { describe, expect, it } from "vitest";
import { canAccessCrmDashboard, canAccessErpDashboard, dashboardHomeForRole, erpDashboardRoleView } from "@/lib/dashboard-access";

describe("dashboard access matrix", () => {
  it("keeps CRM and ERP dashboard roles mutually isolated except for super admin", () => {
    expect(canAccessCrmDashboard("SUPER_ADMIN")).toBe(true);
    expect(canAccessErpDashboard("SUPER_ADMIN")).toBe(true);
    expect(canAccessCrmDashboard("SALES")).toBe(true);
    expect(canAccessErpDashboard("SALES")).toBe(false);
    expect(canAccessCrmDashboard("FOREIGN_TRADE")).toBe(true);
    expect(canAccessErpDashboard("FOREIGN_TRADE")).toBe(false);
    expect(canAccessCrmDashboard("PURCHASE")).toBe(false);
    expect(canAccessErpDashboard("PURCHASE")).toBe(true);
    expect(canAccessCrmDashboard("WAREHOUSE")).toBe(false);
    expect(canAccessErpDashboard("WAREHOUSE")).toBe(true);
  });

  it("chooses the approved default dashboard and never opens an unknown role", () => {
    expect(dashboardHomeForRole("SUPER_ADMIN")).toBe("/dashboard/crm");
    expect(dashboardHomeForRole("SALES")).toBe("/dashboard/crm");
    expect(dashboardHomeForRole("FOREIGN_TRADE")).toBe("/dashboard/crm");
    expect(dashboardHomeForRole("PURCHASE")).toBe("/dashboard/erp");
    expect(dashboardHomeForRole("WAREHOUSE")).toBe("/dashboard/erp");
    expect(dashboardHomeForRole("UNKNOWN")).toBeNull();
  });

  it("maps only ERP roles to an ERP response view", () => {
    expect(erpDashboardRoleView("SUPER_ADMIN")).toBe("ADMIN");
    expect(erpDashboardRoleView("PURCHASE")).toBe("PURCHASE");
    expect(erpDashboardRoleView("WAREHOUSE")).toBe("WAREHOUSE");
    expect(erpDashboardRoleView("SALES")).toBeNull();
  });
});
