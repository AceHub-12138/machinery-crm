import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listLeadAssignees: vi.fn(),
  assignHumanLeads: vi.fn(),
  submitLeadInvalidFeedbackBatch: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/modules/crm/leads/assignment", () => ({
  listLeadAssignees: mocks.listLeadAssignees,
  assignHumanLeads: mocks.assignHumanLeads,
}));
vi.mock("@/modules/crm/leads/feedback", () => ({
  submitLeadInvalidFeedbackBatch: mocks.submitLeadInvalidFeedbackBatch,
}));

import { GET as getAssignees } from "@/app/api/crm/leads/assignees/route";
import { POST as postAssignments } from "@/app/api/crm/leads/assignments/route";
import { POST as postBatchInvalid } from "@/app/api/crm/leads/batch-invalid/route";

const admin = { id: "admin-1", role: "SUPER_ADMIN", region: "总部", territories: [], viewScope: "ALL" } as const;
const post = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: "POST",
  body: JSON.stringify(body),
});

describe("Lead 批量操作路由", () => {
  beforeEach(() => vi.clearAllMocks());

  it("候选负责人接口使用当前 Session 并返回真实销售列表", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.listLeadAssignees.mockResolvedValue([{ id: "sales-1", role: "SALES" }]);
    const response = await getAssignees();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "sales-1", role: "SALES" }]);
    expect(mocks.listLeadAssignees).toHaveBeenCalledWith(admin);
  });

  it("批量指派把请求体交给服务端领域权限检查", async () => {
    const body = { leadIds: ["lead-1"], assignedUserId: "sales-1" };
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.assignHumanLeads.mockResolvedValue({ items: [{ id: "lead-1", assignedUserId: "sales-1" }] });
    const response = await postAssignments(post("/api/crm/leads/assignments", body));
    expect(response.status).toBe(200);
    expect(mocks.assignHumanLeads).toHaveBeenCalledWith(admin, body);
  });

  it("批量无效把 feedbackVersion 一并传入既有反馈领域逻辑", async () => {
    const body = { items: [{ leadId: "lead-1", expectedFeedbackVersion: 2 }], reviewReasonCode: "NO_CONTACT" };
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.submitLeadInvalidFeedbackBatch.mockResolvedValue({ items: [{ id: "lead-1", feedbackVersion: 3 }] });
    const response = await postBatchInvalid(post("/api/crm/leads/batch-invalid", body));
    expect(response.status).toBe(200);
    expect(mocks.submitLeadInvalidFeedbackBatch).toHaveBeenCalledWith(admin, body);
  });

  it.each([
    [postAssignments, "/api/crm/leads/assignments"],
    [postBatchInvalid, "/api/crm/leads/batch-invalid"],
  ])("未登录写操作返回 401", async (handler, path) => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await handler(post(path, {}));
    expect(response.status).toBe(401);
  });

  it("领域权限拒绝保持 403", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.assignHumanLeads.mockRejectedValue(new DomainError("只有超级管理员可以分配 Lead", 403));
    const response = await postAssignments(post("/api/crm/leads/assignments", {}));
    expect(response.status).toBe(403);
  });
});
