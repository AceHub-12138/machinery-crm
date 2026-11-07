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
  return splitAndSanitizePhones([...(text.match(MOBILE) ?? []), ...(text.match(LANDLINE) ?? [])]);
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
export function verifiedPageContact(pointer: unknown, pageText: string) {
  const normalized = sanitizeLlmPhone(pointer);
  return normalized ? extractPhones(pageText).find((phone) => phoneKey(phone.value) === phoneKey(normalized))?.value ?? null : null;
}
export function pagePhoneEvidence(sourceUrl: string | null, text: string, phone: string, now = new Date()) {
  const match = [...text.matchAll(MOBILE), ...text.matchAll(LANDLINE)].find((entry) => {
    const value = sanitizeLlmPhone(entry[0]); return value && phoneKey(value) === phoneKey(phone);
  });
  const index = match?.index ?? 0;
  return { sourceUrl, excerpt: text.slice(Math.max(0, index - 40), index + (match?.[0].length ?? phone.length) + 40), extractedAt: now.toISOString() };
}
