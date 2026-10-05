import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { submitLeadFeedback } from "./feedback";

const admin: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "",
  territories: [],
  viewScope: "ALL",
};

const sales: SessionUser = {
  id: "sales-east",
  role: "SALES",
  region: "华东",
  territories: [{ province: "山东", cities: [] }],
  viewScope: "TERRITORY",
};

const foreignTrade: SessionUser = {
  id: "foreign-trade-1",
  role: "FOREIGN_TRADE",
  region: "外贸",
  territories: [{ province: "海外", cities: [] }],
  viewScope: "TERRITORY",
};

function useStatefulLeadDatabase(assignedUserId: string | null = null) {
  const lead = {
    id: "lead-stateful",
    assignedUserId,
    feedbackVersion: 0,
    reviewStatus: "PENDING",
    reviewedByUserId: null as string | null,
    reviewedAt: null as Date | null,
  };
  const events: Array<Record<string, unknown>> = [];
  const transaction = {
    lead: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === lead.id ? { ...lead } : null),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; feedbackVersion: number; assignedUserId?: string };
        data: {
          reviewStatus: string;
          reviewedByUserId: string;
          reviewedAt: Date;
          feedbackVersion: { increment: number };
        };
      }) => {
        const matches = where.id === lead.id
          && where.feedbackVersion === lead.feedbackVersion
          && (where.assignedUserId === undefined || where.assignedUserId === lead.assignedUserId);
        if (!matches) return { count: 0 };
        lead.reviewStatus = data.reviewStatus;
        lead.reviewedByUserId = data.reviewedByUserId;
        lead.reviewedAt = data.reviewedAt;
        lead.feedbackVersion += data.feedbackVersion.increment;
        return { count: 1 };
      }),
    },
    leadFeedbackEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `event-${events.length + 1}`;
        events.push({ id, ...data });
        return { id };
      }),
    },
    $queryRaw: vi.fn(async () => [{
      assignedUserId: lead.assignedUserId,
      feedbackVersion: lead.feedbackVersion,
    }]),
  };
  mocks.transaction.mockImplementation(async (
    callback: (tx: typeof transaction) => Promise<unknown>,
  ) => callback(transaction));
  return { lead, events };
}

describe("Lead 人工质量反馈", () => {
  beforeEach(() => vi.clearAllMocks());

  it("拒绝非法 reviewStatus", async () => {
    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "HOT",
      reviewReasonCode: "MATCHED_HIGH_INTENT",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 400,
    }));
  });

  it("拒绝把 PENDING 作为人工反馈结果", async () => {
    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "PENDING",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 400,
    }));
  });

  it("拒绝白名单之外的原因码", async () => {
    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "ARBITRARY_REASON",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 400,
    }));
  });

  it("拒绝没有备注的 OTHER 原因", async () => {
    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "LOW_INTENT",
      reviewReasonCode: "OTHER",
      comment: "   ",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 400,
    }));
  });

  it("拒绝与反馈状态不匹配的原因码", async () => {
    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "INVALID_COMPANY",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 400,
    }));
  });

  it("允许 SUPER_ADMIN 提交反馈并返回最新摘要和事件 id", async () => {
    const reviewedAt = new Date("2026-08-20T05:00:00.000Z");
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: null, feedbackVersion: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leadFeedbackEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-1" }),
      },
    }));

    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "MATCHED_HIGH_INTENT",
      comment: "客户近期有明确采购计划",
      expectedFeedbackVersion: 0,
    }, { now: () => reviewedAt })).resolves.toEqual({
      id: "lead-1",
      reviewStatus: "HIGH_INTENT",
      reviewedByUserId: "admin-1",
      reviewedAt,
      feedbackVersion: 1,
      feedbackEventId: "event-1",
    });
  });

  it("拒绝 SALES 跨区域反馈明确指派给其他销售的 Lead", async () => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: "sales-south", feedbackVersion: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leadFeedbackEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
    }));

    await expect(submitLeadFeedback(sales, "lead-1", {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 403,
    }));
  });

  it.each([
    [sales, foreignTrade.id],
    [foreignTrade, sales.id],
  ] as const)("国内 SALES 与 FOREIGN_TRADE 不能互相反馈对方的 Lead", async (user, assignedUserId) => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-business-line", assignedUserId, feedbackVersion: 0 }),
      },
    }));

    await expect(submitLeadFeedback(user, "lead-business-line", {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 403,
    }));
  });

  it("允许 SALES 反馈明确指派给本人的 Lead", async () => {
    const updateLead = vi.fn().mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: sales.id, feedbackVersion: 2 }),
        updateMany: updateLead,
      },
      leadFeedbackEvent: { create: vi.fn().mockResolvedValue({ id: "event-sales" }) },
    }));

    await expect(submitLeadFeedback(sales, "lead-1", {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 2,
    })).resolves.toEqual(expect.objectContaining({
      reviewedByUserId: sales.id,
      feedbackVersion: 3,
      feedbackEventId: "event-sales",
    }));
    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "lead-1",
        feedbackVersion: 2,
        assignedUserId: sales.id,
      },
      data: expect.objectContaining({ feedbackVersion: { increment: 1 } }),
    }));
  });

  it("允许 FOREIGN_TRADE 反馈明确指派给本人的 Lead", async () => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-foreign", assignedUserId: foreignTrade.id, feedbackVersion: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leadFeedbackEvent: { create: vi.fn().mockResolvedValue({ id: "event-foreign" }) },
    }));

    await expect(submitLeadFeedback(foreignTrade, "lead-foreign", {
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "MATCHED_HIGH_INTENT",
      expectedFeedbackVersion: 0,
    })).resolves.toEqual(expect.objectContaining({
      reviewedByUserId: foreignTrade.id,
      feedbackVersion: 1,
      feedbackEventId: "event-foreign",
    }));
  });

  it("拒绝销售角色反馈未指派 Lead", async () => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-unassigned", assignedUserId: null, feedbackVersion: 0 }),
      },
    }));

    await expect(submitLeadFeedback(sales, "lead-unassigned", {
      reviewStatus: "LOW_INTENT",
      reviewReasonCode: "NO_PURCHASE_SIGNAL",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 403,
    }));
  });

  it("拒绝非 CRM 人类角色提交 Lead 反馈", async () => {
    const warehouse: SessionUser = {
      id: "warehouse-1",
      role: "WAREHOUSE",
      region: "",
      territories: [],
      viewScope: "ALL",
    };

    await expect(submitLeadFeedback(warehouse, "lead-1", {
      reviewStatus: "LOW_INTENT",
      reviewReasonCode: "NO_PURCHASE_SIGNAL",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 403,
    }));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("版本冲突时返回 409 且不新增反馈事件", async () => {
    const createEvent = vi.fn();
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: null, feedbackVersion: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      leadFeedbackEvent: { create: createEvent },
      $queryRaw: vi.fn().mockResolvedValue([{ assignedUserId: null, feedbackVersion: 2 }]),
    }));

    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "MATCHED_HIGH_INTENT",
      expectedFeedbackVersion: 1,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 409,
    }));
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("权限检查后 Lead 被改派时返回 403 而不是版本冲突", async () => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: sales.id, feedbackVersion: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ assignedUserId: "sales-south", feedbackVersion: 0 }]),
    }));

    await expect(submitLeadFeedback(sales, "lead-1", {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 403,
    }));
  });

  it("Lead 不存在时返回 404", async () => {
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: { findUnique: vi.fn().mockResolvedValue(null) },
    }));

    await expect(submitLeadFeedback(admin, "missing-lead", {
      reviewStatus: "INVALID",
      reviewReasonCode: "INVALID_COMPANY",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 404,
    }));
  });

  it("同一事务追加事件并同步 Lead 摘要，不触碰历史事件", async () => {
    const historicalEvent: Record<string, unknown> = {
      id: "event-old",
      reviewStatus: "LOW_INTENT",
      reviewReasonCode: "NO_PURCHASE_SIGNAL",
      comment: null,
    };
    const events = [{ ...historicalEvent }];
    const updateLead = vi.fn().mockResolvedValue({ count: 1 });
    const createEvent = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      events.push({ id: "event-new", ...data });
      return { id: "event-new" };
    });
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ id: "lead-1", assignedUserId: null, feedbackVersion: 4 }),
        updateMany: updateLead,
      },
      leadFeedbackEvent: { create: createEvent },
    }));

    const reviewedAt = new Date("2026-08-20T06:00:00.000Z");
    await submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "INVALID",
      reviewReasonCode: "NO_CONTACT",
      comment: "公开渠道无法取得有效联系方式",
      expectedFeedbackVersion: 4,
    }, { now: () => reviewedAt });

    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        reviewStatus: "INVALID",
        reviewedByUserId: admin.id,
        reviewedAt,
        feedbackVersion: { increment: 1 },
      },
    }));
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        leadId: "lead-1",
        reviewStatus: "INVALID",
        reviewReasonCode: "NO_CONTACT",
        comment: "公开渠道无法取得有效联系方式",
        reviewedByUserId: admin.id,
        reviewedAt,
      },
    }));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      id: "event-old",
      reviewStatus: "LOW_INTENT",
      reviewReasonCode: "NO_PURCHASE_SIGNAL",
      comment: null,
    });
    expect(events[1]).toEqual(expect.objectContaining({
      id: "event-new",
      reviewStatus: "INVALID",
      reviewReasonCode: "NO_CONTACT",
    }));
  });

  it("连续两次合法反馈保留两条事件并把版本逐次加一", async () => {
    const database = useStatefulLeadDatabase();

    await submitLeadFeedback(admin, "lead-stateful", {
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "MATCHED_HIGH_INTENT",
      expectedFeedbackVersion: 0,
    });
    await submitLeadFeedback(admin, "lead-stateful", {
      reviewStatus: "LOW_INTENT",
      reviewReasonCode: "NO_PURCHASE_SIGNAL",
      expectedFeedbackVersion: 1,
    });

    expect(database.lead).toEqual(expect.objectContaining({
      reviewStatus: "LOW_INTENT",
      reviewedByUserId: admin.id,
      feedbackVersion: 2,
    }));
    expect(database.events).toHaveLength(2);
    expect(database.events.map((event) => event.reviewStatus)).toEqual(["HIGH_INTENT", "LOW_INTENT"]);
  });

  it("两个同版本并发反馈只接受一个，另一个明确返回 409", async () => {
    const database = useStatefulLeadDatabase();
    const input = {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 0,
    } as const;

    const results = await Promise.allSettled([
      submitLeadFeedback(admin, "lead-stateful", input),
      submitLeadFeedback(admin, "lead-stateful", input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toEqual(expect.objectContaining({
      status: "rejected",
      reason: expect.objectContaining<Partial<DomainError>>({ status: 409 }),
    }));
    expect(database.lead.feedbackVersion).toBe(1);
    expect(database.events).toHaveLength(1);
  });

  it("数据库并发事务冲突转换为明确的 409 业务错误", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });

    await expect(submitLeadFeedback(admin, "lead-1", {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      expectedFeedbackVersion: 0,
    })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({
      name: "DomainError",
      status: 409,
    }));
  });
});
