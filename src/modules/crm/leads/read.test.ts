import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  leadFindMany: vi.fn(),
  leadCount: vi.fn(),
  leadFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  userFindMany: vi.fn(),
  transaction: vi.fn(),
  lockLead: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    lead: {
      findMany: mocks.leadFindMany,
      count: mocks.leadCount,
      findFirst: mocks.leadFindFirst,
    },
    leadFeedbackEvent: { findMany: mocks.eventFindMany },
    user: { findMany: mocks.userFindMany },
    $transaction: mocks.transaction,
  },
}));

import { getHumanLeadDetail, listHumanLeads } from "./read";

const admin: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "",
  territories: [],
  viewScope: "ALL",
};

const sales: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "华东",
  territories: [{ province: "山东", cities: [] }],
  viewScope: "TERRITORY",
};

const foreignTrade: SessionUser = {
  id: "foreign-1",
  role: "FOREIGN_TRADE",
  region: "外贸",
  territories: [],
  viewScope: "TERRITORY",
};

describe("Lead 人类只读模块", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockLead.mockResolvedValue([{ id: "lead-locked" }]);
    mocks.transaction.mockImplementation(async (callback) => callback({
      lead: { findFirst: mocks.leadFindFirst },
      leadFeedbackEvent: { findMany: mocks.eventFindMany },
      $queryRaw: mocks.lockLead,
    }));
  });

  it("SUPER_ADMIN 无参数读取全部 Lead 并使用稳定默认分页", async () => {
    const createdAt = new Date("2026-08-20T01:00:00.000Z");
    mocks.leadFindMany.mockResolvedValue([{
      id: "lead-1",
      companyName: "山东测试机床有限公司",
      contactName: "张经理",
      phone: "13800000000",
      email: null,
      aiScore: 86,
      reviewStatus: "HIGH_INTENT",
      searchKeyword: "数控插床",
      source: "BAIDU_SEARCH",
      assignedUserId: null,
      createdAt,
      feedbackVersion: 2,
    }]);
    mocks.leadCount.mockResolvedValue(1);

    const result = await listHumanLeads(admin, new URLSearchParams());

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20,
    }));
    expect(result).toEqual({
      items: [expect.objectContaining({ id: "lead-1", assignedUser: null, feedbackVersion: 2 })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  it("UI 可显式默认排除 INVALID，选择无效状态时仍能完整查询", async () => {
    mocks.leadFindMany.mockResolvedValue([]);
    mocks.leadCount.mockResolvedValue(0);

    await listHumanLeads(admin, new URLSearchParams({ excludeInvalid: "1" }));
    expect(mocks.leadFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { reviewStatus: { not: "INVALID" } },
    }));

    await listHumanLeads(admin, new URLSearchParams({ excludeInvalid: "1", reviewStatus: "INVALID" }));
    expect(mocks.leadFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { reviewStatus: "INVALID" },
    }));
  });

  it("SALES 列表只查询本人 Lead 并映射指派用户", async () => {
    mocks.leadFindMany.mockResolvedValue([{
      id: "lead-sales",
      companyName: "本人线索",
      assignedUserId: sales.id,
      feedbackVersion: 0,
    }]);
    mocks.leadCount.mockResolvedValue(1);
    mocks.userFindMany.mockResolvedValue([{
      id: sales.id,
      name: "华东销售",
      email: "sales@example.test",
      role: "SALES",
    }]);

    const result = await listHumanLeads(sales, new URLSearchParams());

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedUserId: sales.id },
    }));
    expect(mocks.leadCount).toHaveBeenCalledWith({ where: { assignedUserId: sales.id } });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: "lead-sales",
      assignedUser: expect.objectContaining({ id: sales.id, name: "华东销售" }),
    }));
  });

  it("FOREIGN_TRADE 列表只查询本人 Lead", async () => {
    mocks.leadFindMany.mockResolvedValue([]);
    mocks.leadCount.mockResolvedValue(0);

    await listHumanLeads(foreignTrade, new URLSearchParams());

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedUserId: foreignTrade.id },
    }));
    expect(mocks.leadCount).toHaveBeenCalledWith({ where: { assignedUserId: foreignTrade.id } });
  });

  it("SALES 手工传入其他指派人筛选也不能覆盖 ownership", async () => {
    mocks.leadFindMany.mockResolvedValue([]);
    mocks.leadCount.mockResolvedValue(0);

    await listHumanLeads(sales, new URLSearchParams({ assignedUserId: "sales-other" }));

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedUserId: sales.id },
    }));
  });

  it("分页参数限制在安全边界", async () => {
    mocks.leadFindMany.mockResolvedValue([]);
    mocks.leadCount.mockResolvedValue(0);

    const result = await listHumanLeads(admin, new URLSearchParams({ page: "0", pageSize: "999" }));

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }));
    expect(result.pagination).toEqual({ page: 1, pageSize: 100, total: 0, totalPages: 0 });
  });

  it("SUPER_ADMIN 可组合状态、评分、关键词、指派人与创建日期筛选", async () => {
    mocks.leadFindMany.mockResolvedValue([]);
    mocks.leadCount.mockResolvedValue(0);
    const params = new URLSearchParams({
      reviewStatus: "HIGH_INTENT",
      aiScoreMin: "60",
      aiScoreMax: "90",
      searchKeyword: "数控插床",
      assignedUserId: "sales-2",
      createdFrom: "2026-08-01",
      createdTo: "2026-08-20",
    });

    await listHumanLeads(admin, params);

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        reviewStatus: "HIGH_INTENT",
        aiScore: { gte: 60, lte: 90 },
        searchKeyword: { contains: "数控插床" },
        assignedUserId: "sales-2",
        createdAt: {
          gte: new Date("2026-07-31T16:00:00.000Z"),
          lt: new Date("2026-08-20T16:00:00.000Z"),
        },
      },
    }));
  });

  it("拒绝 AI 评分最小值大于最大值", async () => {
    await expect(listHumanLeads(admin, new URLSearchParams({ aiScoreMin: "91", aiScoreMax: "20" })))
      .rejects.toEqual(expect.objectContaining({ status: 400 }));
    expect(mocks.leadFindMany).not.toHaveBeenCalled();
  });

  it.each([
    { query: { reviewStatus: "HOT" }, label: "非法状态" },
    { query: { aiScoreMin: "-1" }, label: "负数评分" },
    { query: { aiScoreMax: "88.5" }, label: "非整数评分" },
  ])("拒绝筛选边界：$label", async ({ query }) => {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    await expect(listHumanLeads(admin, params))
      .rejects.toEqual(expect.objectContaining({ status: 400 }));
    expect(mocks.leadFindMany).not.toHaveBeenCalled();
  });

  it("拒绝不存在的创建日期", async () => {
    await expect(listHumanLeads(admin, new URLSearchParams({ createdFrom: "2026-02-31" })))
      .rejects.toEqual(expect.objectContaining({ status: 400 }));
    expect(mocks.leadFindMany).not.toHaveBeenCalled();
  });

  it("拒绝创建开始日期晚于结束日期", async () => {
    await expect(listHumanLeads(admin, new URLSearchParams({ createdFrom: "2026-08-21", createdTo: "2026-08-20" })))
      .rejects.toEqual(expect.objectContaining({ status: 400 }));
    expect(mocks.leadFindMany).not.toHaveBeenCalled();
  });

  it("详情使用同一 ownership where，并保留旧事件空状态和 reviewer", async () => {
    const reviewedAt = new Date("2026-08-19T01:00:00.000Z");
    mocks.leadFindFirst.mockResolvedValue({
      id: "lead-sales",
      companyName: "销售本人线索",
      contactName: "李经理",
      phone: "13800000001",
      email: "lead@example.test",
      source: "BAIDU_SEARCH",
      sourceUrl: "https://example.test/lead",
      searchKeyword: "插齿机",
      aiScore: 72,
      profile: { industry: "机械制造" },
      sourceModelVersion: "model-v1",
      extractorVersion: "extractor-v1",
      reviewStatus: "MID_INTENT",
      assignedUserId: sales.id,
      reviewedByUserId: "reviewer-1",
      reviewedAt,
      feedbackVersion: 1,
      createdAt: new Date("2026-08-18T01:00:00.000Z"),
      updatedAt: reviewedAt,
    });
    mocks.eventFindMany.mockResolvedValue([{
      id: "event-old",
      leadId: "lead-sales",
      reviewStatus: null,
      reviewReasonCode: "NEEDS_FOLLOWUP",
      comment: "旧事件",
      reviewedByUserId: "reviewer-1",
      reviewedAt,
    }]);
    mocks.userFindMany.mockResolvedValue([
      { id: sales.id, name: "华东销售", email: "sales@example.test", role: "SALES" },
      { id: "reviewer-1", name: "复核人", email: "reviewer@example.test", role: "SUPER_ADMIN" },
    ]);

    const result = await getHumanLeadDetail(sales, "lead-sales");

    expect(mocks.leadFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "lead-sales", assignedUserId: sales.id },
    }));
    expect(mocks.eventFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { leadId: "lead-sales" },
      orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
    }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.lockLead).toHaveBeenCalledTimes(1);
    expect(mocks.lockLead.mock.invocationCallOrder[0]).toBeLessThan(mocks.eventFindMany.mock.invocationCallOrder[0]);
    expect(result).toEqual(expect.objectContaining({
      id: "lead-sales",
      assignedUser: expect.objectContaining({ id: sales.id, name: "华东销售" }),
      reviewedByUser: expect.objectContaining({ id: "reviewer-1", name: "复核人" }),
      feedbackEvents: [expect.objectContaining({
        id: "event-old",
        reviewStatus: null,
        reviewedByUser: expect.objectContaining({ id: "reviewer-1", name: "复核人" }),
      })],
    }));
  });

  it("SALES 读取其他人的 Lead 时安全返回 404", async () => {
    mocks.leadFindFirst.mockResolvedValue(null);

    await expect(getHumanLeadDetail(sales, "lead-other"))
      .rejects.toEqual(expect.objectContaining({ status: 404 }));
    expect(mocks.leadFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "lead-other", assignedUserId: sales.id },
    }));
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
  });
});
