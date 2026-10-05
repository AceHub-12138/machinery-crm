import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/permissions";
import { assertCanManageSalesTarget, assertCanReadSalesTarget } from "./permissions";

const user = (role: SessionUser["role"]): SessionUser => ({
  id: role,
  role,
  region: "",
  territories: [],
  viewScope: role === "SUPER_ADMIN" ? "ALL" : "TERRITORY",
});

describe("sales target permissions", () => {
  it("allows CRM roles to read but only SUPER_ADMIN to write", () => {
    for (const role of ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"] as const) {
      expect(() => assertCanReadSalesTarget(user(role))).not.toThrow();
    }
    expect(() => assertCanManageSalesTarget(user("SUPER_ADMIN"))).not.toThrow();
    expect(() => assertCanManageSalesTarget(user("SALES"))).toThrowError(/无权限设置销售目标/);
    expect(() => assertCanManageSalesTarget(user("FOREIGN_TRADE"))).toThrowError(/无权限设置销售目标/);
  });

  it("keeps PURCHASE and WAREHOUSE outside CRM target data", () => {
    expect(() => assertCanReadSalesTarget(user("PURCHASE"))).toThrowError(/无权限访问 CRM工作台/);
    expect(() => assertCanReadSalesTarget(user("WAREHOUSE"))).toThrowError(/无权限访问 CRM工作台/);
  });
});
