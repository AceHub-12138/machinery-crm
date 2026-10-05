import { describe, expect, it } from "vitest";
import {
  AFTER_SALES_ORDER_TYPES,
  AFTER_SALES_STATUS,
  afterSalesOrderAlertState,
  afterSalesOrderWhere,
  canTransitionAfterSalesStatus,
  mergeAfterSalesPartNames,
  isPrismaUniqueError,
  normalizeAfterSalesServiceAddress,
  validateAfterSalesReceipt,
  validateAfterSalesOrderInput,
} from "./after-sales";

describe("after-sales order validation", () => {
  it("requires a service amount only for out-of-warranty paid service", () => {
    expect(() => validateAfterSalesOrderInput({ orderType: "OUT_WARRANTY_PAID", serviceAmount: null })).toThrow("质保外有偿服务必须填写服务金额");
    expect(() => validateAfterSalesOrderInput({ orderType: "NEW_MACHINE_DEBUG", serviceAmount: 10 })).toThrow("仅质保外有偿服务可填写服务金额");
    expect(validateAfterSalesOrderInput({ orderType: "OUT_WARRANTY_PAID", serviceAmount: "100.50" }).serviceAmount).toBe(100.5);
  });

  it("uses the explicit order-type whitelist", () => {
    expect(AFTER_SALES_ORDER_TYPES).toContain("NEW_MACHINE_DEBUG");
    expect(() => validateAfterSalesOrderInput({ orderType: "UNKNOWN", serviceAmount: null })).toThrow("工单类型无效");
  });

  it("normalizes an optional service address and rejects values longer than 255 characters", () => {
    expect(normalizeAfterSalesServiceAddress(undefined)).toBeNull();
    expect(normalizeAfterSalesServiceAddress("  山东省滕州市开发区  ")).toBe("山东省滕州市开发区");
    expect(() => normalizeAfterSalesServiceAddress("a".repeat(256))).toThrow("服务地址不能超过 255 个字符");
  });
});

describe("after-sales receipt and closure flow", () => {
  it("requires another-reason when the problem category is OTHER", () => {
    expect(() => validateAfterSalesReceipt({ completedDate: "2026-09-01", receiptContent: "已处理", problemCategory: "OTHER", otherReason: "" })).toThrow("选择其他原因时必须填写具体原因");
  });

  it("accepts only the three optional satisfaction values", () => {
    const baseReceipt = { completedDate: "2026-09-01", receiptContent: "已处理", problemCategory: "MECHANICAL", otherReason: "" };
    expect(validateAfterSalesReceipt({ ...baseReceipt, satisfaction: "SATISFIED" }).satisfaction).toBe("SATISFIED");
    expect(validateAfterSalesReceipt({ ...baseReceipt, satisfaction: "" }).satisfaction).toBeNull();
    expect(() => validateAfterSalesReceipt({ ...baseReceipt, satisfaction: "EXCELLENT" })).toThrow("满意度无效");
  });

  it("enforces the configured state sequence and signed attachment closure gate", () => {
    expect(AFTER_SALES_STATUS).toContain("COMPLETED");
    expect(canTransitionAfterSalesStatus("PENDING_DISPATCH", "DISPATCHED", false)).toBe(true);
    expect(canTransitionAfterSalesStatus("DISPATCHED", "COMPLETED", false)).toBe(false);
    expect(canTransitionAfterSalesStatus("COMPLETED", "CLOSED", false)).toBe(false);
    expect(canTransitionAfterSalesStatus("COMPLETED", "CLOSED", true)).toBe(true);
  });

  it("marks the day before the deadline yellow and an exceeded deadline red", () => {
    const order = { dispatchDate: "2026-09-01T00:00:00.000Z", orderType: "NEW_MACHINE_DEBUG" as const, urgency: "NORMAL" as const, status: "IN_PROGRESS" as const };
    expect(afterSalesOrderAlertState(order, new Date("2026-09-03T00:00:00.000Z"))).toBe("warning");
    expect(afterSalesOrderAlertState(order, new Date("2026-09-05T00:00:00.000Z"))).toBe("danger");
  });
});

describe("after-sales scope", () => {
  it("binds non-admin orders to the existing customer territory filter", () => {
    const user = { id: "sales-1", role: "SALES" as const, region: "", viewScope: "TERRITORY", territories: [{ province: "山东", cities: ["济南"] }] };
    expect(afterSalesOrderWhere(user)).toEqual({ deletedAt: null, customer: { businessLine: "国内销售", OR: [{ province: "山东", city: { in: ["济南"] } }] } });
  });
});

describe("after-sales parts", () => {
  it("returns the de-duplicated union of active BOM material names and supplement names", () => {
    expect(mergeAfterSalesPartNames(["丝杠", "轴承"], ["轴承", "现场专用工具"])).toEqual(["丝杠", "现场专用工具", "轴承"]);
  });

  it("recognizes the database unique-constraint outcome used to reject duplicate supplement names", () => {
    expect(isPrismaUniqueError({ code: "P2002" })).toBe(true);
    expect(isPrismaUniqueError({ code: "P2003" })).toBe(false);
  });
});
