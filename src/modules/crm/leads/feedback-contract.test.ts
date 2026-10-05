import { describe, expect, it } from "vitest";
import {
  HUMAN_LEAD_REVIEW_STATUSES,
  LEAD_FEEDBACK_REASON_CODES,
  leadFeedbackReasonsForStatus,
  requiresLeadFeedbackComment,
} from "./feedback-contract";

describe("Lead 反馈共享契约", () => {
  it("前后端共享 5A 状态和原因码白名单", () => {
    expect(HUMAN_LEAD_REVIEW_STATUSES).toEqual(["HIGH_INTENT", "MID_INTENT", "LOW_INTENT", "INVALID"]);
    expect(LEAD_FEEDBACK_REASON_CODES).toEqual([
      "MATCHED_HIGH_INTENT",
      "NEEDS_FOLLOWUP",
      "NO_PURCHASE_SIGNAL",
      "INDUSTRY_MISMATCH",
      "NO_CONTACT",
      "DUPLICATE",
      "INVALID_COMPANY",
      "OTHER",
    ]);
    expect(leadFeedbackReasonsForStatus("HIGH_INTENT")).toEqual(["MATCHED_HIGH_INTENT", "OTHER"]);
    expect(leadFeedbackReasonsForStatus("INVALID")).toEqual([
      "INDUSTRY_MISMATCH",
      "NO_CONTACT",
      "DUPLICATE",
      "INVALID_COMPANY",
      "OTHER",
    ]);
    expect(requiresLeadFeedbackComment("OTHER")).toBe(true);
    expect(requiresLeadFeedbackComment("NEEDS_FOLLOWUP")).toBe(false);
  });
});
