export const HUMAN_LEAD_REVIEW_STATUSES = [
  "HIGH_INTENT",
  "MID_INTENT",
  "LOW_INTENT",
  "INVALID",
] as const;

export type HumanLeadReviewStatus = (typeof HUMAN_LEAD_REVIEW_STATUSES)[number];

export const LEAD_FEEDBACK_REASON_CODES = [
  "MATCHED_HIGH_INTENT",
  "NEEDS_FOLLOWUP",
  "NO_PURCHASE_SIGNAL",
  "INDUSTRY_MISMATCH",
  "NO_CONTACT",
  "DUPLICATE",
  "INVALID_COMPANY",
  "OTHER",
] as const;

export type LeadFeedbackReasonCode = (typeof LEAD_FEEDBACK_REASON_CODES)[number];

const reasonsByStatus: Record<HumanLeadReviewStatus, readonly LeadFeedbackReasonCode[]> = {
  HIGH_INTENT: ["MATCHED_HIGH_INTENT", "OTHER"],
  MID_INTENT: ["NEEDS_FOLLOWUP", "OTHER"],
  LOW_INTENT: ["NO_PURCHASE_SIGNAL", "OTHER"],
  INVALID: ["INDUSTRY_MISMATCH", "NO_CONTACT", "DUPLICATE", "INVALID_COMPANY", "OTHER"],
};

export const LEAD_REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: "待反馈",
  HIGH_INTENT: "高意向",
  MID_INTENT: "中意向",
  LOW_INTENT: "低意向",
  INVALID: "无效线索",
};

export const LEAD_FEEDBACK_REASON_LABELS: Record<LeadFeedbackReasonCode, string> = {
  MATCHED_HIGH_INTENT: "明确高意向",
  NEEDS_FOLLOWUP: "需要继续跟进",
  NO_PURCHASE_SIGNAL: "暂无采购信号",
  INDUSTRY_MISMATCH: "行业不匹配",
  NO_CONTACT: "无有效联系方式",
  DUPLICATE: "重复线索",
  INVALID_COMPANY: "无效公司",
  OTHER: "其他",
};

export function leadFeedbackReasonsForStatus(status: HumanLeadReviewStatus) {
  return reasonsByStatus[status];
}

export function requiresLeadFeedbackComment(reasonCode: LeadFeedbackReasonCode) {
  return reasonCode === "OTHER";
}
