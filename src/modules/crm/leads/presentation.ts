import { LEAD_REVIEW_STATUS_LABELS } from "@/modules/crm/leads/feedback-contract";

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  BAIDU_SEARCH: "百度搜索",
  MANUAL: "人工录入",
  OTHER: "其他",
};

export function leadStatusLabel(status: string) {
  return LEAD_REVIEW_STATUS_LABELS[status] || status;
}

export function historicalLeadStatusLabel(status: string | null) {
  return status ? leadStatusLabel(status) : "历史状态未记录";
}

export function safeLeadSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export type LeadProfileSection = {
  title: string;
  values: string[];
  kind: "text" | "list";
};

function profileRecord(profile: unknown): Record<string, unknown> | null {
  return profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textValues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(textValue).filter((entry): entry is string => Boolean(entry));
}

function intentLevelLabel(value: unknown) {
  const normalized = textValue(value)?.toUpperCase();
  if (normalized === "HIGH") return "高意向";
  if (normalized === "MEDIUM" || normalized === "MID") return "中意向";
  if (normalized === "LOW") return "低意向";
  return textValue(value) || null;
}

function confidenceLabel(value: unknown) {
  const normalized = textValue(value)?.toUpperCase();
  if (normalized === "HIGH") return "高";
  if (normalized === "MEDIUM" || normalized === "MID") return "中";
  if (normalized === "LOW") return "低";
  return textValue(value) || null;
}

function addSection(
  sections: LeadProfileSection[],
  title: string,
  values: string[],
  kind: LeadProfileSection["kind"],
) {
  if (values.length > 0) sections.push({ title, values, kind });
}

export function buildLeadProfileSections(profile: unknown): LeadProfileSection[] {
  const record = profileRecord(profile);
  if (!record) return [];
  const sections: LeadProfileSection[] = [];
  const summary = textValue(record.summary);
  const industry = textValue(record.industry);
  const intentLevel = intentLevelLabel(record.intentLevel);
  const intent = textValue(record.intent);
  const scale = textValue(record.scale);
  const contactability = textValue(record.contactability);
  const confidence = confidenceLabel(record.confidence);
  const evidence = textValues(record.evidence);
  const reason = textValue(record.reason);
  const needs = [
    ...textValues(record.processNeeds),
    ...textValues(record.businessScope),
    ...textValues(record.purchaseSignals),
  ];
  const advice = textValue(record.salesAdvice)
    || textValue(record.followUpSuggestion)
    || textValue(record.recommendation);

  addSection(sections, "客户概况", summary ? [summary] : [], "text");
  addSection(sections, "所属行业", industry ? [industry] : [], "text");
  addSection(sections, "AI 意向判断", intentLevel ? [intentLevel] : [], "text");
  addSection(sections, "AI 需求描述", intent ? [intent] : [], "text");
  addSection(sections, "企业规模", scale ? [scale] : [], "text");
  addSection(sections, "联系情况", contactability ? [contactability] : [], "text");
  addSection(sections, "AI 判断置信度", confidence ? [confidence] : [], "text");
  addSection(sections, "重点依据", evidence.length ? evidence : reason ? [reason] : [], evidence.length ? "list" : "text");
  addSection(sections, "潜在需求", needs, "list");
  addSection(sections, "风险提示", textValues(record.riskFlags), "list");
  addSection(sections, "销售建议", advice ? [advice] : [], "text");
  return sections;
}
