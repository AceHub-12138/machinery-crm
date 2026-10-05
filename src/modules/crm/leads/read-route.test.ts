import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listHumanLeads: vi.fn(),
  getHumanLeadDetail: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/modules/crm/leads/read", () => ({
  listHumanLeads: mocks.listHumanLeads,
  getHumanLeadDetail: mocks.getHumanLeadDetail,
}));

import { GET as listLeads } from "@/app/api/crm/leads/route";
import { GET as getLead } from "@/app/api/crm/leads/[id]/route";

describe("Lead 人类只读 Route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("列表未登录时返回 401", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await listLeads(new NextRequest("http://localhost/api/crm/leads"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
    expect(mocks.listHumanLeads).not.toHaveBeenCalled();
  });

  it("SERVICE Header 不能替代列表或详情的人类 Session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const listRequest = new NextRequest("http://localhost/api/crm/leads", {
      headers: { authorization: "Bearer service-assertion-placeholder" },
    });
    const detailRequest = new NextRequest("http://localhost/api/crm/leads/lead-1", {
      headers: { authorization: "Bearer service-assertion-placeholder" },
    });

    const listResponse = await listLeads(listRequest);
    const detailResponse = await getLead(detailRequest, { params: Promise.resolve({ id: "lead-1" }) });

    expect(listResponse.status).toBe(401);
    expect(detailResponse.status).toBe(401);
    await expect(listResponse.json()).resolves.toEqual({ error: "未登录" });
    await expect(detailResponse.json()).resolves.toEqual({ error: "未登录" });
    expect(mocks.listHumanLeads).not.toHaveBeenCalled();
    expect(mocks.getHumanLeadDetail).not.toHaveBeenCalled();
  });

  it("列表和详情把同一个 Session 用户交给只读模块", async () => {
    const user = { id: "sales-1", role: "SALES", region: "", territories: [], viewScope: "TERRITORY" } as const;
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listHumanLeads.mockResolvedValue({ items: [], pagination: { page: 2 } });
    mocks.getHumanLeadDetail.mockResolvedValue({ id: "lead-1" });

    const listResponse = await listLeads(new NextRequest("http://localhost/api/crm/leads?page=2&reviewStatus=PENDING"));
    const detailResponse = await getLead(
      new NextRequest("http://localhost/api/crm/leads/lead-1"),
      { params: Promise.resolve({ id: "lead-1" }) },
    );

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(mocks.listHumanLeads).toHaveBeenCalledWith(user, expect.any(URLSearchParams));
    const forwardedParams = mocks.listHumanLeads.mock.calls[0][1] as URLSearchParams;
    expect(Object.fromEntries(forwardedParams)).toEqual({ page: "2", reviewStatus: "PENDING" });
    expect(mocks.getHumanLeadDetail).toHaveBeenCalledWith(user, "lead-1");
  });

  it.each([
    [403, "无权限访问 AI 线索池"],
    [404, "Lead 不存在或无权访问"],
  ] as const)("详情映射领域错误 %i", async (status, message) => {
    mocks.getSessionUser.mockResolvedValue({ id: "sales-1", role: "SALES" });
    mocks.getHumanLeadDetail.mockRejectedValue(new DomainError(message, status));

    const response = await getLead(
      new NextRequest("http://localhost/api/crm/leads/lead-1"),
      { params: Promise.resolve({ id: "lead-1" }) },
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
