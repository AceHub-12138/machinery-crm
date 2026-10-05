import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), userFindMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction, user: { findMany: mocks.userFindMany } } }));

import { assignHumanLeads, listLeadAssignees } from "./assignment";

const admin: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "总部",
  territories: [],
  viewScope: "ALL",
};

const sales: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "华东",
  territories: [{ province: "山东省", cities: [] }],
  viewScope: "TERRITORY",
};

describe("Lead 人工分配", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUPER_ADMIN 可以把单条未指派 Lead 分配给启用销售并写审计", async () => {
    const update = vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: "sales-1" });
    const operationLogCreate = vi.fn().mockResolvedValue({ id: "log-1" });
    const lockAssignments = vi.fn().mockResolvedValue([{ id: "lead-1", assignedUserId: null }]);
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { findUnique: vi.fn().mockResolvedValue({ id: "sales-1", role: "SALES", isActive: true }) },
      $queryRaw: lockAssignments,
      lead: { update },
      operationLog: { create: operationLogCreate },
    }));

    await expect(assignHumanLeads(admin, {
      leadIds: ["lead-1"],
      assignedUserId: "sales-1",
    })).resolves.toEqual({ items: [{ id: "lead-1", assignedUserId: "sales-1" }] });

    expect(update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { assignedUserId: "sales-1" },
      select: { id: true, assignedUserId: true },
    });
    expect(lockAssignments.mock.calls[0][0].strings.join(" ")).toContain("FOR UPDATE");
    expect(operationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "MANUAL_ASSIGN",
        entityType: "Lead",
        entityId: "lead-1",
        beforeData: { assignedUserId: null },
        afterData: { assignedUserId: "sales-1" },
      }),
    });
  });

  it("重复指派同一负责人不写伪造的 REASSIGN 审计", async () => {
    const update = vi.fn();
    const operationLogCreate = vi.fn();
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { findUnique: vi.fn().mockResolvedValue({ id: "sales-1", role: "SALES", isActive: true }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "lead-1", assignedUserId: "sales-1" }]),
      lead: { update },
      operationLog: { create: operationLogCreate },
    }));
    await expect(assignHumanLeads(admin, { leadIds: ["lead-1"], assignedUserId: "sales-1" }))
      .resolves.toEqual({ items: [{ id: "lead-1", assignedUserId: "sales-1" }] });
    expect(update).not.toHaveBeenCalled();
    expect(operationLogCreate).not.toHaveBeenCalled();
  });

  it("重新分配时保留旧负责人并记录 REASSIGN", async () => {
    const operationLogCreate = vi.fn().mockResolvedValue({ id: "log-1" });
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { findUnique: vi.fn().mockResolvedValue({ id: "sales-2", role: "FOREIGN_TRADE", isActive: true }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "lead-1", assignedUserId: "sales-1" }]),
      lead: { update: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: "sales-2" }) },
      operationLog: { create: operationLogCreate },
    }));

    await assignHumanLeads(admin, { leadIds: ["lead-1"], assignedUserId: "sales-2" });

    expect(operationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "REASSIGN",
        beforeData: { assignedUserId: "sales-1" },
        afterData: { assignedUserId: "sales-2" },
      }),
    });
  });

  it("SALES 越权改派在数据库事务前返回 403", async () => {
    await expect(assignHumanLeads(sales, { leadIds: ["lead-1"], assignedUserId: "sales-2" }))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("0 selection 返回 400 且不写数据库", async () => {
    await expect(assignHumanLeads(admin, { leadIds: [], assignedUserId: "sales-1" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["不存在", null],
    ["已停用", { id: "sales-1", role: "SALES", isActive: false }],
    ["非销售角色", { id: "warehouse-1", role: "WAREHOUSE", isActive: true }],
  ])("拒绝%s的目标用户", async (_label, assignee) => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { findUnique: vi.fn().mockResolvedValue(assignee) },
    }));
    await expect(assignHumanLeads(admin, { leadIds: ["lead-1"], assignedUserId: "target-1" }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("批量分配按请求顺序更新并逐条审计", async () => {
    const update = vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, assignedUserId: "sales-1" }));
    const operationLogCreate = vi.fn().mockResolvedValue({ id: "log" });
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { findUnique: vi.fn().mockResolvedValue({ id: "sales-1", role: "SALES", isActive: true }) },
      $queryRaw: vi.fn().mockResolvedValue([
        { id: "lead-2", assignedUserId: null },
        { id: "lead-1", assignedUserId: null },
      ]),
      lead: { update },
      operationLog: { create: operationLogCreate },
    }));

    await expect(assignHumanLeads(admin, { leadIds: ["lead-1", "lead-2"], assignedUserId: "sales-1" }))
      .resolves.toEqual({ items: [
        { id: "lead-1", assignedUserId: "sales-1" },
        { id: "lead-2", assignedUserId: "sales-1" },
      ] });
    expect(update).toHaveBeenCalledTimes(2);
    expect(operationLogCreate).toHaveBeenCalledTimes(2);
  });

  it("批量中部分 Lead 不存在时整体失败且不产生部分更新", async () => {
    const update = vi.fn();
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { findUnique: vi.fn().mockResolvedValue({ id: "sales-1", role: "SALES", isActive: true }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "lead-1", assignedUserId: null }]),
      lead: { update },
    }));
    await expect(assignHumanLeads(admin, {
      leadIds: ["lead-1", "missing-lead"],
      assignedUserId: "sales-1",
    })).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it("候选负责人只返回真实启用的销售角色", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "sales-1", name: "销售甲", email: "sales@example.com", role: "SALES" }]);
    await expect(listLeadAssignees(admin)).resolves.toEqual([
      { id: "sales-1", name: "销售甲", email: "sales@example.com", role: "SALES" },
    ]);
    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } },
    }));
  });
});
