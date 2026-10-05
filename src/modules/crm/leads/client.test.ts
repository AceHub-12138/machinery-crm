import { describe, expect, it, vi } from "vitest";
import {
  assignLeadsAndRefresh,
  invalidateLeadsAndRefresh,
  LeadHumanApiError,
  loadLeadAssignees,
  loadHumanLeadList,
  refreshHumanLeadDetail,
  submitLeadFeedbackAndRefresh,
} from "./client";

describe("Lead 反馈前端编排", () => {
  it("Session 失效并被 middleware 重定向到登录页时按 401 处理", async () => {
    const loginResponse = {
      ok: true,
      status: 200,
      redirected: true,
      url: "http://localhost/login",
      json: vi.fn().mockRejectedValue(new SyntaxError("not json")),
    } as unknown as Response;

    await expect(loadHumanLeadList(new URLSearchParams(), vi.fn().mockResolvedValue(loginResponse)))
      .rejects.toEqual(expect.objectContaining<Partial<LeadHumanApiError>>({
        status: 401,
        message: "登录状态已失效，请重新登录",
      }));
  });

  it("详情刷新为 403/404 时清空已缓存 Lead", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "无权访问" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));
    const apply = vi.fn();

    await expect(refreshHumanLeadDetail({ leadId: "lead-1", request, apply }))
      .rejects.toEqual(expect.objectContaining({ status: 404 }));
    expect(apply).toHaveBeenCalledWith(null);
  });

  it("提交当前 feedbackVersion 并在成功后刷新详情", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "lead-1",
        reviewStatus: "HIGH_INTENT",
        feedbackVersion: 4,
        feedbackEventId: "event-4",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "lead-1",
        reviewStatus: "HIGH_INTENT",
        feedbackVersion: 4,
        feedbackEvents: [{ id: "event-4" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const apply = vi.fn();
    const refresh = vi.fn(() => refreshHumanLeadDetail({ leadId: "lead-1", request, apply }));

    await submitLeadFeedbackAndRefresh({
      leadId: "lead-1",
      feedback: {
        reviewStatus: "HIGH_INTENT",
        reviewReasonCode: "MATCHED_HIGH_INTENT",
        comment: "近期采购计划明确",
        expectedFeedbackVersion: 3,
      },
      request,
      refresh,
    });

    expect(request).toHaveBeenCalledWith("/api/crm/leads/lead-1/feedback", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewStatus: "HIGH_INTENT",
        reviewReasonCode: "MATCHED_HIGH_INTENT",
        comment: "近期采购计划明确",
        expectedFeedbackVersion: 3,
      }),
    }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      feedbackVersion: 4,
      feedbackEvents: [{ id: "event-4" }],
    }));
  });

  it("409 使用明确冲突提示并重新拉取最新 feedbackVersion", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "反馈版本已变化" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "lead-1",
        reviewStatus: "INVALID",
        feedbackVersion: 4,
        feedbackEvents: [{ id: "event-newer" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const apply = vi.fn();
    const refresh = vi.fn(() => refreshHumanLeadDetail({ leadId: "lead-1", request, apply }));

    await expect(submitLeadFeedbackAndRefresh({
      leadId: "lead-1",
      feedback: {
        reviewStatus: "MID_INTENT",
        reviewReasonCode: "NEEDS_FOLLOWUP",
        expectedFeedbackVersion: 3,
      },
      request,
      refresh,
    })).rejects.toEqual(expect.objectContaining<Partial<LeadHumanApiError>>({
      status: 409,
      message: "线索已被其他操作更新，请刷新后重试",
    }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      reviewStatus: "INVALID",
      feedbackVersion: 4,
      feedbackEvents: [{ id: "event-newer" }],
    }));
  });

  it.each([
    [400, "原因码与状态不匹配", "原因码与状态不匹配"],
    [403, "内部权限文案", "你无权反馈当前线索"],
    [404, "内部不存在文案", "线索不存在或已不可访问"],
  ] as const)("%i 返回明确前端反馈", async (status, serverMessage, expectedMessage) => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: serverMessage }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
    const refresh = vi.fn();

    await expect(submitLeadFeedbackAndRefresh({
      leadId: "lead-1",
      feedback: {
        reviewStatus: "LOW_INTENT",
        reviewReasonCode: "NO_PURCHASE_SIGNAL",
        expectedFeedbackVersion: 1,
      },
      request,
      refresh,
    })).rejects.toEqual(expect.objectContaining({ status, message: expectedMessage }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("加载专用 Lead 候选负责人列表", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: "sales-1", name: "销售甲", email: "sales@example.com", role: "SALES" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(loadLeadAssignees(request)).resolves.toEqual([
      { id: "sales-1", name: "销售甲", email: "sales@example.com", role: "SALES" },
    ]);
    expect(request).toHaveBeenCalledWith("/api/crm/leads/assignees", { cache: "no-store" });
  });

  it("单条或批量指派成功后刷新当前 Lead 视图", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: "lead-1" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const refresh = vi.fn().mockResolvedValue(undefined);
    await assignLeadsAndRefresh({ leadIds: ["lead-1"], assignedUserId: "sales-1", request, refresh });
    expect(request).toHaveBeenCalledWith("/api/crm/leads/assignments", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ leadIds: ["lead-1"], assignedUserId: "sales-1" }),
    }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("批量无效 stale 时刷新版本并保留 409 提示", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "反馈版本已变化" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));
    const refresh = vi.fn().mockResolvedValue(undefined);
    await expect(invalidateLeadsAndRefresh({
      items: [{ leadId: "lead-1", expectedFeedbackVersion: 2 }],
      reviewReasonCode: "NO_CONTACT",
      request,
      refresh,
    })).rejects.toMatchObject({ status: 409, message: "线索已被其他操作更新，请刷新后重试" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
