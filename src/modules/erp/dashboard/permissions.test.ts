import { describe, expect, it } from "vitest";
import { canSeeInventoryAmount, canSeeProcurementDetails, resolveErpDashboardView } from "@/modules/erp/dashboard/permissions";
import type { SessionUser } from "@/lib/permissions";

const user = (role: SessionUser["role"]): SessionUser => ({ id: "u", role, region: "", territories: [], viewScope: "TERRITORY" });

describe("ERP dashboard role projection", () => {
  it("does not create an ERP view for CRM roles", () => {
    expect(() => resolveErpDashboardView(user("SALES"))).toThrow("无权限");
    expect(() => resolveErpDashboardView(user("FOREIGN_TRADE"))).toThrow("无权限");
  });

  it("keeps purchasing details and stock value on their approved role views", () => {
    expect(canSeeProcurementDetails("ADMIN")).toBe(true);
    expect(canSeeProcurementDetails("PURCHASE")).toBe(true);
    expect(canSeeProcurementDetails("WAREHOUSE")).toBe(false);
    expect(canSeeInventoryAmount("ADMIN")).toBe(true);
    expect(canSeeInventoryAmount("WAREHOUSE")).toBe(true);
    expect(canSeeInventoryAmount("PURCHASE")).toBe(false);
  });
});
