import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { submitLeadInvalidFeedbackBatch } from "./feedback";

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

function useDatabase(initial: Array<{ id: string; assignedUserId: string | null; feedbackVersion: number }>) {
  const leads = new Map(initial.map((lead) => [lead.id, { ...lead, reviewStatus: "PENDING" }]));
  const events: Array<Record<string, unknown>> = [];
  const customerCreate = vi.fn();
  const transaction = {
    lead: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const lead = leads.get(where.id);
        return lead ? { ...lead } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; feedbackVersion: number; assignedUserId?: string };
        data: { reviewStatus: string; reviewedByUserId: string; reviewedAt: Date; feedbackVersion: { increment: number } };
      }) => {
        const lead = leads.get(where.id);
        if (!lead || lead.feedbackVersion !== where.feedbackVersion) return { count: 0 };
        if (where.assignedUserId !== undefined && lead.assignedUserId !== where.assignedUserId) return { count: 0 };
        lead.feedbackVersion += data.feedbackVersion.increment;
        lead.reviewStatus = data.reviewStatus;
        return { count: 1 };
      }),
    },
    leadFeedbackEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `event-${events.length + 1}`, ...data };
        events.push(event);
        return { id: event.id };
      }),
    },
    customer: { create: customerCreate },
    $queryRaw: vi.fn(async () => [] as Array<Record<string, unknown>>),
  };
  transaction.$queryRaw.mockImplementation(async () => []);
  mocks.transaction.mockImplementation(async (callback) => {
    const leadSnapshot = new Map([...leads].map(([id, lead]) => [id, { ...lead }]));
    const eventCount = events.length;
    transaction.$queryRaw.mockImplementation(async () => []);
    try {
      return await callback({
        ...transaction,
        $queryRaw: async () => {
          const changed = [...leads.values()].find((lead) => lead.feedbackVersion > (leadSnapshot.get(lead.id)?.feedbackVersion ?? -1));
          const fallback = changed || [...leads.values()][0];
          return fallback ? [{ assignedUserId: fallback.assignedUserId, feedbackVersion: fallback.feedbackVersion }] : [];
        },
      });
    } catch (error) {
      leads.clear();
      leadSnapshot.forEach((lead, id) => leads.set(id, lead));
      events.length = eventCount;
      throw error;
    }
  });
  return { leads, events, customerCreate };
}

describe("Lead 批量标记无效", () => {
  beforeEach(() => vi.clearAllMocks());

  it("0 selection 返回 400 且不开始事务", async () => {
    await expect(submitLeadInvalidFeedbackBatch(admin, {
      items: [],
      reviewReasonCode: "INVALID_COMPANY",
    })).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("单条批量无效复用反馈事件并增长 feedbackVersion", async () => {
    const database = useDatabase([{ id: "lead-1", assignedUserId: null, feedbackVersion: 0 }]);
    await expect(submitLeadInvalidFeedbackBatch(admin, {
      items: [{ leadId: "lead-1", expectedFeedbackVersion: 0 }],
      reviewReasonCode: "INVALID_COMPANY",
    })).resolves.toEqual({ items: [expect.objectContaining({
      id: "lead-1",
      reviewStatus: "INVALID",
      feedbackVersion: 1,
    })] });
    expect(database.leads.get("lead-1")).toEqual(expect.objectContaining({ reviewStatus: "INVALID", feedbackVersion: 1 }));
    expect(database.events).toEqual([expect.objectContaining({ leadId: "lead-1", reviewStatus: "INVALID" })]);
  });

  it("多条批量无效逐条追加不可变事件且不删除 Lead", async () => {
    const database = useDatabase([
      { id: "lead-1", assignedUserId: null, feedbackVersion: 0 },
      { id: "lead-2", assignedUserId: null, feedbackVersion: 2 },
    ]);
    await submitLeadInvalidFeedbackBatch(admin, {
      items: [
        { leadId: "lead-1", expectedFeedbackVersion: 0 },
        { leadId: "lead-2", expectedFeedbackVersion: 2 },
      ],
      reviewReasonCode: "NO_CONTACT",
    });
    expect(database.leads.size).toBe(2);
    expect(database.events).toHaveLength(2);
    expect(database.customerCreate).not.toHaveBeenCalled();
    expect([...database.leads.values()].map((lead) => lead.feedbackVersion)).toEqual([1, 3]);
  });

  it("部分无权限时整个批次返回 403 并回滚已处理项", async () => {
    const database = useDatabase([
      { id: "lead-1", assignedUserId: "sales-1", feedbackVersion: 0 },
      { id: "lead-2", assignedUserId: "sales-2", feedbackVersion: 0 },
    ]);
    await expect(submitLeadInvalidFeedbackBatch(sales, {
      items: [
        { leadId: "lead-1", expectedFeedbackVersion: 0 },
        { leadId: "lead-2", expectedFeedbackVersion: 0 },
      ],
      reviewReasonCode: "INVALID_COMPANY",
    })).rejects.toMatchObject({ status: 403 });
    expect([...database.leads.values()].map((lead) => lead.feedbackVersion)).toEqual([0, 0]);
    expect(database.events).toHaveLength(0);
  });

  it("任一 stale feedbackVersion 返回 409 且不产生事件", async () => {
    const database = useDatabase([{ id: "lead-1", assignedUserId: null, feedbackVersion: 2 }]);
    await expect(submitLeadInvalidFeedbackBatch(admin, {
      items: [{ leadId: "lead-1", expectedFeedbackVersion: 1 }],
      reviewReasonCode: "INVALID_COMPANY",
    })).rejects.toMatchObject({ status: 409 });
    expect(database.leads.get("lead-1")?.feedbackVersion).toBe(2);
    expect(database.events).toHaveLength(0);
  });
});
