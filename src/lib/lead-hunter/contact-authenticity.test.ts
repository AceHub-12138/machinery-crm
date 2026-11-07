import { afterEach, describe, expect, it, vi } from "vitest";
import { splitAndSanitizePhones, sanitizeEmails, verifiedPageContact } from "./phone";
import { leadRuntimeFlags } from "./runtime-flags";
import { companyOperatingStatus, createTianyanchaClient, matchCompanyIdentity, parseTianyanchaResponse } from "./tianyancha";
afterEach(() => vi.unstubAllEnvs());
describe("contact authenticity", () => {
  it("[AUDIT-T1] production ignores mocks and missing token never creates numbers", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("LEAD_TYC_MOCK", "1"); vi.stubEnv("LEAD_TYC_TOKEN", "");
    expect(leadRuntimeFlags({ NODE_ENV: "production", LEAD_TYC_MOCK: "1", LEAD_HUNTER_FAKE_SEARCH: "1" })).toEqual({ fakeSearchMode: false, tycMockMode: false });
    const request = vi.fn();
    await expect(createTianyanchaClient({ fetchImpl: request }).lookupCompany("甲公司")).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });
  it("[AUDIT-T5] splits numbers, removes placeholders, normalizes prefixes and reads emailList", () => {
    expect(splitAndSanitizePhones("0571-88881234;13800001111").map((p) => p.value)).toEqual(["13800001111", "0571-88881234"]);
    expect(splitAndSanitizePhones("400-123-4567；8001234567 95588 96111 10612345678 - 无 暂无 12345")).toEqual([]);
    expect(splitAndSanitizePhones("+86 13800001111 / 13800001111 | 0571-88881234转123")).toHaveLength(2);
    expect(parseTianyanchaResponse({ error_code: 0, result: { emailList: ["A@B.COM", "a@b.com", "bad"] } }).emails).toEqual(["a@b.com"]);
    expect(sanitizeEmails("A@B.COM；bad")).toEqual(["a@b.com"]);
  });
  it("[AUDIT-T4] inactive statuses override active wording", () => {
    for (const status of ["注销", "吊销未注销", "撤销", "迁出", "停业"]) expect(companyOperatingStatus(status)).toBe("INACTIVE");
    expect(companyOperatingStatus("存续")).toBe("ACTIVE"); expect(companyOperatingStatus(null)).toBe("UNKNOWN");
  });
  it("matches normalized names and historical names, never approximate names", () => {
    expect(matchCompanyIdentity("甲（山东）有限公司", "甲(山东)有限公司")).toBe("MATCH");
    expect(matchCompanyIdentity("乙公司", "甲公司", ["乙公司"])).toBe("MATCH");
    expect(matchCompanyIdentity("甲公司", "甲乙公司")).toBe("MISMATCH");
  });
  it("[AUDIT-E2] AI phone pointers must exactly match extracted source numbers", () => {
    expect(verifiedPageContact("13800001111", "联系 13900001111")).toBeNull();
    expect(verifiedPageContact("+86 13800001111", "联系 13800001111")).toBe("13800001111");
  });
  it("uses HTTPS, distinguishes business errors and keeps bounded valid evidence", async () => {
    vi.stubEnv("LEAD_TYC_TOKEN", "test-only"); vi.stubEnv("LEAD_TYC_MOCK", "0");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_code: 0, result: { name: "甲公司", historyNames: "乙公司；丙公司", token: "do-not-store" } })));
    const result = await createTianyanchaClient({ fetchImpl: request }).lookupCompany("甲公司");
    expect(request.mock.calls[0][0]).toMatch(/^https:/); expect(result.historyNames).toEqual(["乙公司", "丙公司"]);
    expect(JSON.stringify(result.raw)).not.toContain("do-not-store");
    expect(parseTianyanchaResponse({ error_code: 300000 }).outcome).toBe("NOT_FOUND");
    expect(parseTianyanchaResponse({ error_code: 1, result: { name: "伪结果" } }).outcome).toBe("FAILED");
  });
});
