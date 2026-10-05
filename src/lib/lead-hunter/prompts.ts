/**
 * 获客引擎的两个 LLM 提示词：关键词规划 + 线索分析评分。
 * 原 n8n 工作流的两段 prompt 存放在 FastGPT 应用内、不在导出 JSON 里；
 * 这里按导出 JSON 体现的输入/输出契约（keywords[]、validatedLead 字段、评分 0-100、标准省市全称）重建，语义对齐。
 */

import { PROVINCE_CITY_MAP } from "@/lib/region-data";
import { sanitizeLlmPhone } from "@/lib/lead-hunter/phone";
import type { RoundSummary } from "@/lib/lead-hunter/types";
import type { WebSearchResult } from "@/lib/lead-hunter/qianfan";

export type KeywordPlannerFeedback = {
  summary: RoundSummary;
  lowScoreReasons: string[];
  usedQueries: string[];
};

const KEYWORD_SYSTEM = [
  "你是 B2B 获客搜索关键词规划师。",
  "根据目标客户描述，给出一组适合百度搜索的中文关键词（3~5 个），",
  "用于找到目标企业的官网、黄页、招聘页、名录、采购招标、行业新闻等页面。",
  "关键词要具体（含行业/产品/工艺/地区词），避免「厂家」「公司」这类过宽泛词。",
  "严格输出 JSON：{\"keywords\": [\"关键词1\", \"关键词2\"]}，不要输出任何其他文字。",
].join("");

export function keywordPlannerPrompt(goal: string, round: number, feedback: KeywordPlannerFeedback | null): { system: string; user: string; maxTokens: number } {
  if (round <= 1 || !feedback) {
    return {
      system: KEYWORD_SYSTEM,
      user: `目标客户描述：${goal}\n请给出第 1 轮搜索关键词。`,
      maxTokens: 500,
    };
  }
  const processed = feedback.summary.candidates;
  const qualified = feedback.summary.qualified;
  const rate = processed > 0 ? Math.round((qualified / processed) * 100) : 0;
  const reasonSample = feedback.lowScoreReasons.filter(Boolean).slice(0, 5).join("；") || "无";
  const user = [
    `目标客户描述：${goal}`,
    `上一轮（第 ${feedback.summary.round} 轮）使用关键词：${feedback.summary.keywords.join("、") || "无"}`,
    `上一轮结果：处理 ${processed} 条，达标 ${qualified} 条，达标率 ${rate}%；低分原因样例：${reasonSample}`,
    `已用过的关键词（不要重复，换角度覆盖）：${feedback.usedQueries.join("、") || "无"}`,
    `请优化生成第 ${round} 轮关键词。`,
  ].join("\n");
  return { system: KEYWORD_SYSTEM, user, maxTokens: 500 };
}

export function extractKeywords(planned: unknown): string[] {
  const raw = (planned as { keywords?: unknown })?.keywords;
  const keywords = Array.isArray(raw)
    ? raw.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (keywords.length < 1) throw new Error("关键词输出为空");
  return keywords.slice(0, 5);
}

const ANALYSIS_SYSTEM = [
  "你是大川机床的销售线索分析专家。公司产品：数控插床、数控插齿机、插床、齿轮加工机床、键槽加工机床、带锯床、五轴加工中心等数控与常规机床。",
  "从给出的搜索结果中识别一家最明确的企业，并评估它采购上述设备的潜力。",
  "",
  "评分 aiScore（0-100 整数）衡量「该企业成为目标客户的匹配度与采购意向」：",
  "1. 行业匹配：主营业务是否属于机加工、零件制造、传动件、阀门、自动化设备等可能使用上述机床的领域，越匹配越高；",
  "2. 采购信号：扩产、新厂房、新产线、招聘操作工/技工/机加工师傅、设备采购招标等加分；",
  "3. 地域明确：能从文本判断企业所在省市加分；",
  "4. 联系方式：文本中直接出现手机号是强信号加分；仅座机是弱信号少量加分；无电话不影响（后续可反查），不扣分。",
  "",
  "严格输出 JSON（不要输出任何其他文字）：",
  '{"isCompany": true, "companyName": "企业工商全称", "aiScore": 0, "scoreReason": "一句话理由", "province": "浙江省", "city": "宁波市", "contactName": "联系人或空串", "phone": "文本中的手机或带区号座机，原样摘录，400/106 等号码一律空串", "email": "或空串"}',
  "",
  "province 必须用「浙江省」这类省级标准全称，city 用「宁波市」这类地级市标准全称，判断不出留空串；",
  "搜索结果里没有明确企业时 isCompany=false，其余字段给空串或 0 分。",
].join("\n");

export type LeadAnalysis = {
  isCompany: boolean;
  companyName: string;
  aiScore: number;
  scoreReason: string;
  province: string;
  city: string;
  contactName: string;
  phone: string | null;
  email: string | null;
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function validProvince(value: unknown): string {
  const text = String(value ?? "").trim();
  return text && text in PROVINCE_CITY_MAP ? text : "";
}

function validCity(province: string, value: unknown): string {
  const text = String(value ?? "").trim();
  if (!province || !text) return "";
  const cities = PROVINCE_CITY_MAP[province] ?? [];
  return cities.includes(text) ? text : "";
}

/** 调 LLM 做单条线索分析并做结构与业务校验（不合法即抛错，由引擎按「AI 解析失败」统计） */
export async function analyzeLead(
  llm: (options: { system: string; user: string; maxTokens: number }) => Promise<unknown>,
  input: { goal: string; keyword: string; item: WebSearchResult },
): Promise<LeadAnalysis> {
  const pageText = [input.item.snippet, input.item.content].filter(Boolean).join("\n").slice(0, 3000);
  const user = [
    `目标客户描述：${input.goal}`,
    `搜索关键词：${input.keyword}`,
    `标题：${input.item.title}`,
    `来源：${input.item.website || input.item.url}`,
    `正文：${pageText}`,
  ].join("\n");

  const parsed = await llm({ system: ANALYSIS_SYSTEM, user, maxTokens: 700 }) as Record<string, unknown>;
  const aiScore = Number(parsed?.aiScore);
  if (!Number.isFinite(aiScore) || aiScore < 0 || aiScore > 100) throw new Error("评分无效");
  const companyName = String(parsed?.companyName ?? "").trim();
  const isCompany = parsed?.isCompany !== false && Boolean(companyName);
  const province = validProvince(parsed?.province);
  const emailText = String(parsed?.email ?? "").trim();
  return {
    isCompany,
    companyName,
    aiScore: Math.round(aiScore),
    scoreReason: String(parsed?.scoreReason ?? "").trim().slice(0, 500),
    province,
    city: validCity(province, parsed?.city),
    contactName: String(parsed?.contactName ?? "").trim().slice(0, 64),
    phone: sanitizeLlmPhone(parsed?.phone),
    email: EMAIL_RE.test(emailText) ? emailText : null,
  };
}

export type { WebSearchResult };
