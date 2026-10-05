import type {
  HumanLeadReviewStatus,
  LeadFeedbackReasonCode,
} from "@/modules/crm/leads/feedback-contract";
import type {
  HumanLeadDetail,
  HumanLeadListResponse,
  LeadUserSummary,
} from "@/modules/crm/leads/types";

export type LeadFeedbackUiInput = {
  reviewStatus: HumanLeadReviewStatus;
  reviewReasonCode: LeadFeedbackReasonCode;
  comment?: string;
  expectedFeedbackVersion: number;
};

export class LeadHumanApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "LeadHumanApiError";
  }
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function isLoginRedirect(response: Response) {
  if (!response.redirected || !response.url) return false;
  try {
    return new URL(response.url).pathname.startsWith("/login");
  } catch {
    return false;
  }
}

function feedbackErrorMessage(status: number, serverMessage: unknown) {
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 409) return "线索已被其他操作更新，请刷新后重试";
  if (status === 403) return "你无权反馈当前线索";
  if (status === 404) return "线索不存在或已不可访问";
  if (status === 400) return typeof serverMessage === "string" && serverMessage ? serverMessage : "反馈内容不合法，请检查后重试";
  return "反馈提交失败，请稍后重试";
}

function readErrorMessage(status: number, serverMessage: unknown, fallback: string) {
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 403) return "你无权访问 AI 线索池";
  if (status === 404) return "线索不存在或已不可访问";
  return typeof serverMessage === "string" && serverMessage ? serverMessage : fallback;
}

export async function loadHumanLeadList(
  searchParams: URLSearchParams,
  request: typeof fetch = fetch,
): Promise<HumanLeadListResponse> {
  const response = await request(`/api/crm/leads?${searchParams.toString()}`, { cache: "no-store" });
  const data = await responseJson(response);
  if (isLoginRedirect(response)) throw new LeadHumanApiError("登录状态已失效，请重新登录", 401);
  if (!response.ok) {
    throw new LeadHumanApiError(readErrorMessage(response.status, data.error, "AI 线索列表加载失败"), response.status);
  }
  if (!Array.isArray(data.items) || !data.pagination || typeof data.pagination !== "object") {
    throw new LeadHumanApiError("AI 线索列表返回格式异常", 500);
  }
  return data as unknown as HumanLeadListResponse;
}

export async function loadHumanLeadDetail(
  leadId: string,
  request: typeof fetch = fetch,
): Promise<HumanLeadDetail> {
  const response = await request(`/api/crm/leads/${leadId}`, { cache: "no-store" });
  const data = await responseJson(response);
  if (isLoginRedirect(response)) throw new LeadHumanApiError("登录状态已失效，请重新登录", 401);
  if (!response.ok) {
    throw new LeadHumanApiError(readErrorMessage(response.status, data.error, "AI 线索详情加载失败"), response.status);
  }
  if (typeof data.id !== "string") throw new LeadHumanApiError("AI 线索详情返回格式异常", 500);
  return data as unknown as HumanLeadDetail;
}

export async function refreshHumanLeadDetail({
  leadId,
  request = fetch,
  apply,
}: {
  leadId: string;
  request?: typeof fetch;
  apply: (lead: HumanLeadDetail | null) => void;
}) {
  try {
    const lead = await loadHumanLeadDetail(leadId, request);
    apply(lead);
    return lead;
  } catch (error) {
    if (error instanceof LeadHumanApiError && (error.status === 403 || error.status === 404)) {
      apply(null);
    }
    throw error;
  }
}

export async function submitLeadFeedbackAndRefresh({
  leadId,
  feedback,
  request = fetch,
  refresh,
}: {
  leadId: string;
  feedback: LeadFeedbackUiInput;
  request?: typeof fetch;
  refresh: () => Promise<unknown>;
}) {
  const response = await request(`/api/crm/leads/${leadId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedback),
  });
  const data = await responseJson(response);
  if (isLoginRedirect(response)) throw new LeadHumanApiError("登录状态已失效，请重新登录", 401);
  if (!response.ok) {
    if (response.status === 409) await refresh();
    throw new LeadHumanApiError(feedbackErrorMessage(response.status, data.error), response.status);
  }
  await refresh();
  return data;
}

export async function loadLeadAssignees(request: typeof fetch = fetch): Promise<LeadUserSummary[]> {
  const response = await request("/api/crm/leads/assignees", { cache: "no-store" });
  const data = await responseJson(response);
  if (isLoginRedirect(response)) throw new LeadHumanApiError("登录状态已失效，请重新登录", 401);
  if (!response.ok) {
    throw new LeadHumanApiError(readErrorMessage(response.status, data.error, "Lead 候选负责人加载失败"), response.status);
  }
  if (!Array.isArray(data)) throw new LeadHumanApiError("Lead 候选负责人返回格式异常", 500);
  return data as unknown as LeadUserSummary[];
}

export async function assignLeadsAndRefresh({
  leadIds,
  assignedUserId,
  request = fetch,
  refresh,
}: {
  leadIds: string[];
  assignedUserId: string;
  request?: typeof fetch;
  refresh: () => Promise<unknown>;
}) {
  const response = await request("/api/crm/leads/assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadIds, assignedUserId }),
  });
  const data = await responseJson(response);
  if (isLoginRedirect(response)) throw new LeadHumanApiError("登录状态已失效，请重新登录", 401);
  if (!response.ok) {
    const fallback = response.status === 403 ? "只有超级管理员可以分配 Lead" : "Lead 分配失败，请检查后重试";
    throw new LeadHumanApiError(readErrorMessage(response.status, data.error, fallback), response.status);
  }
  await refresh();
  return data;
}

export async function invalidateLeadsAndRefresh({
  items,
  reviewReasonCode,
  comment,
  request = fetch,
  refresh,
}: {
  items: Array<{ leadId: string; expectedFeedbackVersion: number }>;
  reviewReasonCode: LeadFeedbackReasonCode;
  comment?: string;
  request?: typeof fetch;
  refresh: () => Promise<unknown>;
}) {
  const response = await request("/api/crm/leads/batch-invalid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, reviewReasonCode, comment }),
  });
  const data = await responseJson(response);
  if (isLoginRedirect(response)) throw new LeadHumanApiError("登录状态已失效，请重新登录", 401);
  if (!response.ok) {
    if (response.status === 409) await refresh();
    throw new LeadHumanApiError(feedbackErrorMessage(response.status, data.error), response.status);
  }
  await refresh();
  return data;
}
