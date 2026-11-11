import { normalizedCompanyName } from "./dedup";

/** 只提取原文和结构化字段中的号码；AI 输出仅用于选择原文号码。 */
export type ExtractedPhone = { value: string; kind: "mobile" | "landline" };
const MOBILE = /(?<![\dA-Za-z])(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;
const LANDLINE = /(?<![\dA-Za-z])0\d{2,3}[-\s]?\d{7,8}(?:\s*(?:转|分机|ext\.?|[-#])\s*\d{1,6})?(?!\d)/gi;
export function phoneKey(value: string) {
  return value.replace(/\D/g, "").replace(/^86(?=1[3-9]\d{9}$)/, "");
}
function cleanPhone(text: string): ExtractedPhone | null {
  const mobile = text.match(/^(?:\+?86[-\s]?)?(1[3-9]\d{9})$/);
  if (mobile) return { value: mobile[1], kind: "mobile" };
  const landline = text.match(/^(0\d{2,3})[-\s]?(\d{7,8})(?:\s*(?:转|分机|ext\.?|[-#])\s*\d{1,6})?$/i);
  return landline ? { value: landline[1] + (text.startsWith(landline[1] + "-") ? "-" : "") + landline[2], kind: "landline" } : null;
}
export function splitAndSanitizePhones(raw: unknown): ExtractedPhone[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((value) => typeof value === "string"
    ? value.split(/[;；,，、/|\r\n]+/).flatMap((part) => cleanPhone(part.trim()) ? [part.trim()] : part.trim().split(/\s+/)) : []);
  const seen = new Set<string>();
  return parts.map((part) => cleanPhone(part.trim())).filter((phone): phone is ExtractedPhone => {
    if (!phone || seen.has(phoneKey(phone.value))) return false;
    seen.add(phoneKey(phone.value)); return true;
  }).sort((a, b) => Number(b.kind === "mobile") - Number(a.kind === "mobile"));
}
export function extractPhones(text: string): ExtractedPhone[] {
  return splitAndSanitizePhones(pagePhoneMatches(text).map((match) => match[0]));
}
function pagePhoneMatches(text: string) {
  let previous: RegExpMatchArray | undefined;
  let previousWasFax = false;
  return [...text.matchAll(MOBILE), ...text.matchAll(LANDLINE)].sort((a, b) => a.index! - b.index!).filter((match) => {
    // 表格转文字常把标签拆成空格、换行、制表符；先限原文 30 字，再去空白。
    const prefix = Array.from(text.slice(0, match.index)).slice(-30).join("").replace(/[\s\u3000\u00a0]+/gu, "");
    const faxLabel = /(?:传真(?:号码|号)?|fax(?:no|number)?)[\p{P}\p{S}]*(?:[为是][\p{P}\p{S}]*)?(?:fax(?:no|number)?[\p{P}\p{S}]*)?(?:[为是][\p{P}\p{S}]*)?$/iu.test(prefix);
    const continuesFax = previousWasFax && previous !== undefined
      // 传真列表只在同一行传递；标签自身仍允许跨行空白。
      && /^(?:[^\S\r\n]|[/、,，;；])+$/u.test(text.slice(previous.index! + previous[0].length, match.index));
    previousWasFax = faxLabel || continuesFax;
    previous = match;
    return !previousWasFax;
  });
}
export function sanitizeLlmPhone(value: unknown): string | null {
  return typeof value === "string" ? cleanPhone(value.trim())?.value ?? null : null;
}
export function sanitizeEmails(raw: unknown): string[] {
  return [...new Set((Array.isArray(raw) ? raw : [raw]).flatMap((item) => typeof item === "string"
    ? item.split(/[;；,，、|\s]+/) : []).map((email) => email.toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)))];
}
export function extractEmails(text: string): string[] {
  return sanitizeEmails(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []);
}
function companyPhoneMatch(pageText: string, phone: string, companyName: string) {
  const fullName = normalizedCompanyName(companyName);
  if (!fullName) return null;
  const body = fullName.replace(/(?:(?:股份有限公司|有限责任公司|有限公司|集团|公司|厂))+$/u, "");
  const names = [fullName, ...(Array.from(body).length >= 4 ? [body] : [])];
  const companyMentions = (text: string) => {
    const normalized = normalizedCompanyName(text);
    const targetRanges = names.flatMap((name) => {
      const ranges: { start: number; end: number; isBody: boolean }[] = [];
      for (let start = normalized.indexOf(name); start >= 0; start = normalized.indexOf(name, start + 1)) {
        ranges.push({ start, end: start + name.length, isBody: name === body && Array.from(body).length >= 4 });
      }
      return ranges;
    });
    // 只识别有限公司类全称，避免把“公司地址/公司电话/厂址”当成另一企业。
    // 已知局限：名录只写“××厂”或简称、没有有限公司类全称时，无法区分归属。
    // 用后缀位置归属目标区间，避免把“欢迎访问/版权所有/2024”等前缀吞进企业名。
    return [...normalized.matchAll(/股份有限公司|有限责任公司|集团有限公司|有限公司/gu)]
      .filter((entry) => /[\p{Script=Han}a-z0-9]{2}$/u.test(normalized.slice(0, entry.index)))
      .map((entry) => {
        const start = entry.index!;
        const end = start + entry[0].length;
        // 至少四字主体紧接其他有限公司类后缀时，也属于目标；中间夹字则不接受。
        return { start, end, isTarget: targetRanges.some((range) => (range.start <= start && end <= range.end)
          || (range.isBody && range.end === start)) };
      });
  };
  for (const match of pagePhoneMatches(pageText)) {
    const value = sanitizeLlmPhone(match[0]);
    if (!value || phoneKey(value) !== phoneKey(phone)) continue;
    // 在原文上取前后各 80 字，再规范化比对，避免标点被去掉后扩大范围。
    const rawBefore = pageText.slice(0, match.index);
    const rawAfter = pageText.slice(match.index + match[0].length);
    const before = Array.from(rawBefore).slice(-80).join("");
    const after = Array.from(rawAfter).slice(0, 80).join("");
    // 先按原文分条；逗号、顿号、空格、冒号和括号不分条。
    const entryBefore = rawBefore.split(/[\n\r。；;|]/u).pop()!;
    const entryAfter = rawAfter.split(/[\n\r。；;|]/u, 1)[0];
    const entryHasCompany = companyMentions(entryBefore + match[0] + entryAfter).length > 0;
    // 本条无全称才保留第二轮跨条目行为，支持“公司名单独一行、后续行电话”。
    const scopeBefore = entryHasCompany ? Array.from(entryBefore).slice(-80).join("") : before;
    const scopeAfter = entryHasCompany ? Array.from(entryAfter).slice(0, 80).join("") : after;
    const beforeText = normalizedCompanyName(scopeBefore);
    const afterText = normalizedCompanyName(scopeAfter);
    const beforeCompanies = companyMentions(scopeBefore);
    const afterCompanies = companyMentions(scopeAfter);
    const targetBefore = Math.max(...names.map((name) => beforeText.lastIndexOf(name)));
    const targetAfter = Math.min(...names.map((name) => afterText.indexOf(name)).filter((index) => index >= 0));
    const precedingTarget = targetBefore >= 0 && !beforeCompanies.some((company) => !company.isTarget && company.end > targetBefore);
    const nearestBefore = beforeCompanies[beforeCompanies.length - 1];
    const followingTarget = Number.isFinite(targetAfter) && (!nearestBefore || nearestBefore.isTarget)
      && !afterCompanies.some((company) => !company.isTarget && company.start <= targetAfter);
    if (precedingTarget || followingTarget) {
      return { value, excerpt: before + match[0] + after };
    }
  }
  return null;
}
/** 网页号码的前后各 80 字内必须出现目标公司全称或至少 4 字的名称主体。 */
export function phoneNearCompany(pageText: string, phone: string, companyName: string): boolean {
  return companyPhoneMatch(pageText, phone, companyName) !== null;
}
export function verifiedPageContact(pointer: unknown, pageText: string, companyName: string) {
  const normalized = sanitizeLlmPhone(pointer);
  return normalized ? companyPhoneMatch(pageText, normalized, companyName)?.value ?? null : null;
}
export function pagePhoneEvidence(sourceUrl: string | null, text: string, phone: string, companyName: string, now = new Date()) {
  const match = companyPhoneMatch(text, phone, companyName);
  return match ? { sourceUrl, excerpt: match.excerpt, extractedAt: now.toISOString() } : null;
}
