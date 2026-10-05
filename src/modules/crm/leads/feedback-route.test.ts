import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  submitLeadFeedback: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/modules/crm/leads/feedback", () => ({ submitLeadFeedback: mocks.submitLeadFeedback }));

import { POST } from "@/app/api/crm/leads/[id]/feedback/route";

const request = (body: Record<string, unknown> = {}) => new NextRequest(
  "http://localhost/api/crm/leads/lead-1/feedback",
  { method: "POST", body: JSON.stringify(body) },
);
const context = { params: Promise.resolve({ id: "lead-1" }) };

describe("POST /api/crm/leads/[id]/feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("未登录时返回 401", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(request(), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
    expect(mocks.submitLeadFeedback).not.toHaveBeenCalled();
  });

  it("SERVICE 凭据不能替代人类 Session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const serviceRequest = new NextRequest(
      "http://localhost/api/crm/leads/lead-1/feedback",
      {
        method: "POST",
        headers: { authorization: "Bearer service-assertion-placeholder" },
        body: "{}",
      },
    );

    const response = await POST(serviceRequest, context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
    expect(mocks.submitLeadFeedback).not.toHaveBeenCalled();
  });

  it("使用当前 Session 用户提交反馈并返回领域结果", async () => {
    const user = { id: "sales-1", role: "SALES", region: "华东", territories: [], viewScope: "TERRITORY" } as const;
    const body = {
      reviewStatus: "MID_INTENT",
      reviewReasonCode: "NEEDS_FOLLOWUP",
      comment: "下周继续联系",
      expectedFeedbackVersion: 3,
    };
    const result = { id: "lead-1", feedbackVersion: 4, feedbackEventId: "event-1" };
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.submitLeadFeedback.mockResolvedValue(result);

    const response = await POST(request(body), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(mocks.submitLeadFeedback).toHaveBeenCalledWith(user, "lead-1", body);
  });

  it.each([
    [400, "反馈参数不合法"],
    [403, "只能反馈明确指派给本人的 Lead"],
    [404, "Lead 不存在"],
    [409, "反馈版本已变化，请刷新后重试"],
  ] as const)("把领域错误映射为 %i", async (status, message) => {
    mocks.getSessionUser.mockResolvedValue({ id: "admin", role: "SUPER_ADMIN" });
    mocks.submitLeadFeedback.mockRejectedValue(new DomainError(message, status));

    const response = await POST(request(), context);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it("认证或数据库异常时保持统一 500 契约且不回显内部错误", async () => {
    mocks.getSessionUser.mockRejectedValue(new Error("database connection details"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Lead 反馈提交失败" });
    expect(consoleError).toHaveBeenCalledWith("[crm.leads.feedback.POST]", { name: "Error", code: undefined });
    consoleError.mockRestore();
  });
});
