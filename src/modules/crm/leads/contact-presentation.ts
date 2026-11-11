export function contactEvidenceSummary(evidence: unknown) {
  const value = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence as Record<string, unknown> : {};
  return {
    sharedPhoneLeadCount: typeof value.sharedPhoneLeadCount === "number" ? value.sharedPhoneLeadCount : 0,
    sharedPhoneCustomer: typeof value.sharedPhoneCustomer === "string" ? value.sharedPhoneCustomer : null,
    manuallyConfirmed: value.manuallyConfirmed === true,
  };
}
export function phoneSourceLabel(source: string | null | undefined, evidence?: unknown) {
  if (source === "PAGE_TEXT") return "网页原文";
  if (source === "TIANYANCHA") return contactEvidenceSummary(evidence).manuallyConfirmed ? "天眼查（人工确认）" : "天眼查";
  if (source === "MANUAL") return "人工录入";
  return "历史数据，来源未记录";
}
