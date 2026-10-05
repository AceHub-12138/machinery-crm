import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  customerCreate: vi.fn(),
  customerFindFirst: vi.fn(),
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  writeOperationLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findFirst: mocks.customerFindFirst },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/permissions", () => ({
  buildCustomerWhereClause: vi.fn(),
  canSeeAllData: (user: { role: string }) => user.role === "SUPER_ADMIN",
  isSuperAdmin: (user: { role: string }) => user.role === "SUPER_ADMIN",
  matchesTerritory: () => true,
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: mocks.writeOperationLog }));
vi.mock("@/modules/crm/permissions", () => ({ canAccessCrmData: () => true }));

import { createCustomer } from "./service";

const salesUser: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "山东",
  territories: [{ province: "山东省", cities: [] }],
  viewScope: "TERRITORY",
};

const validBody = {
  companyName: "测试客户",
  contactName: "张三",
  province: "山东省",
  customerSource: "展会",
  customerType: "NEW",
  customerLevel: "B",
};

describe("customer create owner permissions", () => {
  beforeEach(() => {
    mocks.customerCreate.mockReset().mockResolvedValue({ id: "customer-1" });
    mocks.customerFindFirst.mockReset().mockResolvedValue(null);
    mocks.userFindFirst.mockReset().mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
    mocks.writeOperationLog.mockReset().mockResolvedValue(undefined);
    mocks.transaction.mockReset().mockImplementation(async (callback) => callback({
      customer: { create: mocks.customerCreate },
    }));
  });

  it("rejects a sales user assigning a new customer to another owner", async () => {
    await expect(createCustomer(salesUser, {
      ...validBody,
      assignedUserId: "sales-2",
    })).rejects.toMatchObject({
      message: "普通销售不能将客户分配给其他负责人",
      status: 403,
    });

    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("defaults a sales user's new customer owner to the current account", async () => {
    await createCustomer(salesUser, validBody);

    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sales-1", isActive: true },
    }));
    expect(mocks.customerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedUserId: "sales-1" }),
    }));
  });

  it("allows a super admin to choose an active owner", async () => {
    await createCustomer({ ...salesUser, id: "admin-1", role: "SUPER_ADMIN", viewScope: "ALL" }, {
      ...validBody,
      assignedUserId: "sales-2",
    });

    expect(mocks.customerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedUserId: "sales-2" }),
    }));
  });
});
