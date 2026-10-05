/**
 * 联系方式提取：正则语义照抄原 n8n「百度获客」工作流。
 * 业务规则（2026-09-05 用户拍板）：手机号为强信号；座机仍收但降权；400 热线一律不认。
 */

const MOBILE_RE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;
const LANDLINE_RE = /(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)/g;

export type ExtractedPhone = { value: string; kind: "mobile" | "landline" };

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").replace(/^86(?=1[3-9])/, "");
}

/** 从文本提取联系方式候选：手机在前（强信号），座机在后（弱信号），同号去重；不识别 400 热线 */
export function extractPhones(text: string): ExtractedPhone[] {
  const phones: ExtractedPhone[] = [];
  const seen = new Set<string>();
  for (const match of text.match(MOBILE_RE) ?? []) {
    const value = match.replace(/\D/g, "").replace(/^86/, "");
    const key = value;
    if (seen.has(key)) continue;
    seen.add(key);
    phones.push({ value, kind: "mobile" });
  }
  for (const match of text.match(LANDLINE_RE) ?? []) {
    const key = digitsOnly(match);
    if (seen.has(key)) continue;
    seen.add(key);
    phones.push({ value: match.trim(), kind: "landline" });
  }
  return phones;
}

/** 校验 LLM 摘录的电话：只收手机或带区号座机，400/106 等一律拒收 */
export function sanitizeLlmPhone(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^(?:\+?86[-\s]?)?1[3-9]\d{9}$/.test(text)) return text;
  if (/^0\d{2,3}[-\s]?\d{7,8}$/.test(text)) return text;
  return null;
}
