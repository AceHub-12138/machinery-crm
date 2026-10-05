import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";
import { assertLeadAccess, leadVisibilityWhere } from "./access";

const user = (role: SessionUser["role"], id = "user-1"): SessionUser => ({
  id,
  role,
  region: "",
  territories: [],
  viewScope: role === "SUPER_ADMIN" ? "ALL" : "TERRITORY",
});

describe("Lead 人类访问范围", () => {
  it("SUPER_ADMIN 使用全量 visibility where", () => {
    expect(leadVisibilityWhere(user("SUPER_ADMIN"))).toEqual({});
  });

  it.each(["SALES", "FOREIGN_TRADE"] as const)("%s 只使用本人 ownership where", (role) => {
    expect(leadVisibilityWhere(user(role, `${role}-1`))).toEqual({ assignedUserId: `${role}-1` });
  });

  it.each(["PURCHASE", "WAREHOUSE"] as const)("%s 被拒绝进入 AI 线索池", (role) => {
    expect(() => leadVisibilityWhere(user(role))).toThrow(expect.objectContaining<Partial<DomainError>>({ status: 403 }));
  });

  it("销售只能访问明确指派给本人的单条 Lead", () => {
    const sales = user("SALES", "sales-1");
    expect(() => assertLeadAccess(sales, { assignedUserId: "sales-1" })).not.toThrow();
    expect(() => assertLeadAccess(sales, { assignedUserId: "sales-2" })).toThrow(expect.objectContaining<Partial<DomainError>>({ status: 403 }));
    expect(() => assertLeadAccess(sales, { assignedUserId: null })).toThrow(expect.objectContaining<Partial<DomainError>>({ status: 403 }));
  });

  it("国内 SALES 与 FOREIGN_TRADE 不能互相访问对方指派 Lead", () => {
    const domestic = user("SALES", "sales-domestic");
    const foreign = user("FOREIGN_TRADE", "sales-foreign");
    expect(() => assertLeadAccess(domestic, { assignedUserId: foreign.id })).toThrow(expect.objectContaining<Partial<DomainError>>({ status: 403 }));
    expect(() => assertLeadAccess(foreign, { assignedUserId: domestic.id })).toThrow(expect.objectContaining<Partial<DomainError>>({ status: 403 }));
  });
});
