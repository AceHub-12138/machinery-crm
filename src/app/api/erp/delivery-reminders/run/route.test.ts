import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), orders: vi.fn(), items: vi.fn(), admins: vi.fn(), transaction: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  procurementConfig: { upsert: mocks.config }, purchaseOrder: { findMany: mocks.orders },
  purchaseOrderItem: { findMany: mocks.items }, user: { findMany: mocks.admins }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.user, isSuperAdmin: (user: { role: string }) => user.role === "SUPER_ADMIN" }));
import { POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  mocks.user.mockResolvedValue({ role: "SUPER_ADMIN" });
  mocks.config.mockResolvedValue({ attentionDays: 7, highRiskDays: 3, urgentDays: 1 });
  mocks.orders.mockResolvedValue([{ id: "po1", orderNo: "PO1", createdById: "purchase" }]);
  mocks.admins.mockResolvedValue([{ id: "admin" }]);
  mocks.items.mockResolvedValue([{ id: "item1", purchaseOrderId: "po1", materialNameSnapshot: "刀具", quantity: new Prisma.Decimal(10), receivedQuantity: new Prisma.Decimal(2), latestPromisedDate: new Date("2026-10-02"), responsibleId: "owner" }]);
});
afterEach(() => vi.useRealTimers());
const run = () => POST(new NextRequest("http://localhost/api/erp/delivery-reminders/run", { method: "POST" }));
it("按原规则生成负责人及管理员通知，重跑只统计实际新建条数", async () => {
  const saved = new Map<string, Prisma.ErpNotificationCreateManyInput>();
  mocks.transaction.mockImplementation(async (callback) => callback({ erpNotification: {
    createMany: async ({ data, skipDuplicates }: { data: Prisma.ErpNotificationCreateManyInput[]; skipDuplicates: boolean }) => {
      expect(skipDuplicates).toBe(true);
      let count = 0;
      for (const notification of data) if (!saved.has(notification.notificationKey)) { saved.set(notification.notificationKey, notification); count++; }
      return { count };
    },
  } }));
  expect(await (await run()).json()).toEqual({ checked: 1, created: 2 });
  expect(await (await run()).json()).toEqual({ checked: 1, created: 0 });
  expect([...saved.values()]).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: "owner", level: "ERROR", content: expect.stringContaining("未到货 8") }),
    expect.objectContaining({ userId: "admin", title: "采购延期升级提醒" }),
  ]));
});
it("批次写入故障传播而不会报告部分成功", async () => {
  mocks.transaction.mockRejectedValue(new Error("write failed"));
  await expect(run()).rejects.toThrow("write failed");
});
it("普通角色无权触发任务", async () => {
  mocks.user.mockResolvedValue({ role: "PURCHASE" });
  expect((await run()).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
