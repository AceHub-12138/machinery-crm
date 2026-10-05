import { describe, expect, it } from "vitest";
import {
  canManageBom,
  canExecuteKitCheck,
  canManageInventory,
  canManageMaterialMaster,
  canManagePurchaseDemands,
  canManagePurchaseOrders,
  canManageSuppliers,
  canPublishProductionOrder,
  canReadMcpBomDetail,
  canRunMcpKitCheck,
  canViewERP,
  customerBusinessLineForRole,
  roleRequiresRegionScope,
} from "@/lib/erp-roles";

describe("ERP role policy", () => {
  it("only sales roles require a customer region scope", () => {
    expect(roleRequiresRegionScope("SALES")).toBe(true);
    expect(roleRequiresRegionScope("FOREIGN_TRADE")).toBe(true);
    expect(roleRequiresRegionScope("SUPER_ADMIN")).toBe(false);
    expect(roleRequiresRegionScope("PURCHASE")).toBe(false);
    expect(roleRequiresRegionScope("WAREHOUSE")).toBe(false);
  });

  it("keeps domestic sales and foreign trade on separate customer business lines", () => {
    expect(customerBusinessLineForRole("SALES")).toBe("国内销售");
    expect(customerBusinessLineForRole("FOREIGN_TRADE")).toBe("外贸");
  });

  it("implements the confirmed five-role warehouse, purchase and administrator matrix", () => {
    const capabilities = {
      material: canManageMaterialMaster,
      bom: canManageBom,
      kitCheck: canExecuteKitCheck,
      purchaseDemand: canManagePurchaseDemands,
      purchaseOrder: canManagePurchaseOrders,
      supplier: canManageSuppliers,
      inventory: canManageInventory,
    };
    const expected = {
      SUPER_ADMIN: [true, true, true, true, true, true, true],
      WAREHOUSE: [true, true, true, true, false, false, true],
      PURCHASE: [false, false, false, true, true, true, false],
      SALES: [false, false, false, false, false, false, false],
      FOREIGN_TRADE: [false, false, false, false, false, false, false],
    } as const;
    for (const [role, results] of Object.entries(expected)) {
      expect(Object.values(capabilities).map((capability) => capability(role))).toEqual(results);
    }
    expect(canViewERP("PURCHASE")).toBe(true);
    expect(canViewERP("WAREHOUSE")).toBe(true);
    expect(canPublishProductionOrder("PURCHASE")).toBe(false);
    expect(canReadMcpBomDetail("SUPER_ADMIN")).toBe(true);
    expect(canReadMcpBomDetail("WAREHOUSE")).toBe(false);
    expect(canRunMcpKitCheck("SUPER_ADMIN")).toBe(true);
    expect(canRunMcpKitCheck("WAREHOUSE")).toBe(false);
  });
});
