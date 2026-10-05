import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assertStockInCanBeVoided,
  canRoleVoidStockIn,
  calculateInventoryAfterStockInVoid,
  normalizeStockInVoidReason,
  StockInVoidRequestError,
} from "./stock-in-void";

const roles = ["SUPER_ADMIN", "WAREHOUSE", "PURCHASE", "SALES", "FOREIGN_TRADE"];
const confirmed = { status: "CONFIRMED" as const, confirmedAt: new Date("2026-08-03T00:00:00.000Z"), voidedAt: null, purchaseOrderId: null, productionOrderId: null, confirmedById: "another-user", actorId: "operator" };

describe("StockIn 作废领域保护", () => {
  it("仅允许超级管理员和仓库角色发起作废", () => {
    expect(Object.fromEntries(roles.map((role) => [role, canRoleVoidStockIn(role)]))).toEqual({
      SUPER_ADMIN: true,
      WAREHOUSE: true,
      PURCHASE: false,
      SALES: false,
      FOREIGN_TRADE: false,
    });
  });

  it("要求长度合规且去首尾空格的作废原因", () => {
    expect(normalizeStockInVoidReason("  入库数量录入错误  ")).toBe("入库数量录入错误");
    expect(() => normalizeStockInVoidReason("短")).toThrow(StockInVoidRequestError);
  });

  it("拒绝已作废单、采购来源、生产退料和确认人自行作废", () => {
    expect(() => assertStockInCanBeVoided({ ...confirmed, status: "VOIDED" })).toThrow("仅已确认");
    expect(() => assertStockInCanBeVoided({ ...confirmed, purchaseOrderId: "purchase-1" })).toThrow("unlink-purchase");
    expect(() => assertStockInCanBeVoided({ ...confirmed, productionOrderId: "production-1" })).toThrow("生产工单变更审批");
    expect(() => assertStockInCanBeVoided({ ...confirmed, confirmedById: "operator" })).toThrow("职责分离");
  });

  it("库存不足时零写入前失败", () => {
    expect(() => calculateInventoryAfterStockInVoid({
      quantity: new Prisma.Decimal("2.00"), totalAmount: new Prisma.Decimal("20.00"), voidQuantity: new Prisma.Decimal("3.00"),
    })).toThrow("当前库存不足");
  });

  it("用 Prisma.Decimal 冲减后与等价出库保持同一移动平均价", () => {
    const result = calculateInventoryAfterStockInVoid({
      quantity: new Prisma.Decimal("12.00"), totalAmount: new Prisma.Decimal("100.00"), voidQuantity: new Prisma.Decimal("3.00"),
    });
    const equivalentStockOutAvgPrice = new Prisma.Decimal("75.00").div(new Prisma.Decimal("9.00")).toDecimalPlaces(2);
    expect(result.reversalAmount).toBeInstanceOf(Prisma.Decimal);
    expect(result.afterAmount).toBeInstanceOf(Prisma.Decimal);
    expect(result.avgPrice).toBeInstanceOf(Prisma.Decimal);
    expect(result.avgPrice?.toDecimalPlaces(2).toString()).toBe(equivalentStockOutAvgPrice.toString());
  });

  it("不让审计金额的两位舍入改变等价出库后的平均价", () => {
    const result = calculateInventoryAfterStockInVoid({
      quantity: new Prisma.Decimal("3.00"), totalAmount: new Prisma.Decimal("1.00"), voidQuantity: new Prisma.Decimal("1.00"),
    });
    const existingStockOutAverage = (1 - (1 / 3) * 1) / (3 - 1);
    expect(result.reversalAmount.toString()).toBe("0.33");
    expect(result.afterAmount.toDecimalPlaces(2).toString()).toBe("0.67");
    expect(result.avgPrice?.toDecimalPlaces(2).toString()).toBe(new Prisma.Decimal(existingStockOutAverage).toDecimalPlaces(2).toString());
  });
});
