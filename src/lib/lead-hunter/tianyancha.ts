import { normalizedCompanyName } from "@/lib/lead-hunter/dedup";
import { sanitizeEmails, splitAndSanitizePhones } from "@/lib/lead-hunter/phone";
import { leadRuntimeFlags, tycConfigured } from "@/lib/lead-hunter/runtime-flags";
import { DomainError } from "@/modules/shared/domain-error";

export type TianyanchaLookup = {
  found: boolean; phone: string | null; legalPerson: string | null; regAddress: string | null;
  raw: Record<string, unknown>; outcome: "FOUND" | "NOT_FOUND" | "FAILED"; reason: string | null;
  companyName: string | null; historyNames: string[]; tycCompanyId: string | null;
  creditCode: string | null; regStatus: string | null; phones: string[]; emails: string[]; isMock: boolean;
};
export type TianyanchaClient = {
  lookupCompany(companyName: string, signal?: AbortSignal): Promise<TianyanchaLookup>;
  /** 旧候选接口过渡兼容；额度由数据库服务管理。 */
  todayCallCount(): number;
};
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const ENDPOINT = "https://open.api.tianyancha.com/services/open/ic/baseinfoV3/2.0";
export function parseHistoryNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap((name) => typeof name === "string" ? name.split(/[;；,\t\r\n]+/) : []).map((name) => name.trim()).filter(Boolean);
}
export function matchCompanyIdentity(queryName: string, name: string | null, historyNames: string[] = []) {
  const query = normalizedCompanyName(queryName);
  return query && [name, ...historyNames].some((value) => value && normalizedCompanyName(value) === query) ? "MATCH" : "MISMATCH";
}
export function companyOperatingStatus(value: string | null): "INACTIVE" | "ACTIVE" | "UNKNOWN" {
  if (/注销|吊销|撤销|迁出|停业/.test(value ?? "")) return "INACTIVE";
  if (/存续|在业|开业|正常/.test(value ?? "")) return "ACTIVE";
  return "UNKNOWN";
}
const str = (value: unknown, max = 191) => typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) || null : null;
function empty(outcome: TianyanchaLookup["outcome"], reason: string): TianyanchaLookup {
  return { outcome, reason, found: false, phone: null, legalPerson: null, regAddress: null, companyName: null, historyNames: [], tycCompanyId: null, creditCode: null, regStatus: null, phones: [], emails: [], isMock: false, raw: {} };
}
export function parseTianyanchaResponse(data: Record<string, unknown>): TianyanchaLookup {
  if (data.error_code === 300000) return empty("NOT_FOUND", "天眼查无数据");
  if (data.error_code !== 0) return empty("FAILED", "天眼查业务错误");
  const row = data.result;
  if (!row || typeof row !== "object" || Array.isArray(row)) return empty("NOT_FOUND", "天眼查无数据");
  const result = row as Record<string, unknown>;
  const phones = splitAndSanitizePhones(result.phoneNumber).map((phone) => phone.value);
  const emails = sanitizeEmails([result.email, ...(Array.isArray(result.emailList) ? result.emailList : [result.emailList])]);
  const value: TianyanchaLookup = {
    ...empty("FOUND", ""), reason: null, found: true, phone: phones[0] ?? null,
    companyName: str(result.name), historyNames: parseHistoryNames(result.historyNames),
    tycCompanyId: str(result.id, 64), creditCode: str(result.creditCode, 32), regStatus: str(result.regStatus, 64),
    legalPerson: str(result.legalPersonName), regAddress: str(result.regLocation, 1000), phones, emails,
  };
  // 仅保留业务字段，避免密钥及无关大字段落库；始终保持有效 JSON。
  value.raw = { name: value.companyName, historyNames: value.historyNames.slice(0, 50), id: value.tycCompanyId, creditCode: value.creditCode, regStatus: value.regStatus, regLocation: value.regAddress, phoneNumber: phones.slice(0, 50), emailList: emails.slice(0, 50) };
  if (Buffer.byteLength(JSON.stringify(value.raw), "utf8") > 20_000) value.raw = { name: value.companyName, truncated: true };
  return value;
}
export function createTianyanchaClient(options?: { fetchImpl?: FetchLike; now?: () => Date }): TianyanchaClient {
  const fetchImpl = options?.fetchImpl ?? fetch;
  return {
    todayCallCount: () => 0,
    async lookupCompany(companyName, signal) {
      if (!tycConfigured()) throw new DomainError("天眼查未配置", 503);
      if (leadRuntimeFlags().tycMockMode) {
        return { ...parseTianyanchaResponse({ error_code: 0, result: { name: companyName, regStatus: "存续", phoneNumber: "13800001111" } }), isMock: true };
      }
      try {
        const response = await fetchImpl(ENDPOINT + "?keyword=" + encodeURIComponent(companyName), {
          headers: { Authorization: process.env.LEAD_TYC_TOKEN!.trim() },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        });
        if (!response.ok) return empty("FAILED", "天眼查请求失败（" + response.status + "）");
        const raw: unknown = await response.json();
        return raw && typeof raw === "object" && !Array.isArray(raw) ? parseTianyanchaResponse(raw as Record<string, unknown>) : empty("FAILED", "天眼查响应格式错误");
      } catch {
        return empty("FAILED", "天眼查网络错误或超时");
      }
    },
  };
}
