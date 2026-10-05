import { describe, expect, it } from "vitest";
import { canAccessCrmData } from "./permissions";
import type { SessionUser } from "@/lib/permissions";

const user = (role: SessionUser["role"]): SessionUser => ({ id: "u1", role, region: "", territories: [], viewScope: "TERRITORY" });

describe("CRM 领域服务权限", () => {
  it("只允许超管、销售和外贸进入 CRM 数据服务", () => {
    expect(canAccessCrmData(user("SUPER_ADMIN"))).toBe(true);
    expect(canAccessCrmData(user("SALES"))).toBe(true);
    expect(canAccessCrmData(user("FOREIGN_TRADE"))).toBe(true);
    expect(canAccessCrmData(user("PURCHASE"))).toBe(false);
    expect(canAccessCrmData(user("WAREHOUSE"))).toBe(false);
  });
});
