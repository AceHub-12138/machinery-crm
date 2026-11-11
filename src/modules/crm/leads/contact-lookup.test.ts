import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/permissions";
import { beijingQuotaDate, confirmLeadContact, lookupLeadContact, reserveLookupQuota, classifyLookup } from "./contact-lookup";
import { parseTianyanchaResponse, type TianyanchaLookup } from "@/lib/lead-hunter/tianyancha";
import { admitCandidates } from "@/lib/lead-hunter/admit";
const admin: SessionUser = { id: "admin", role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" };
const at = new Date("2026-11-06T16:00:00.000Z");
type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some((part) => matches(row, part));
    if (key === "AND") return (value as Row[]).every((part) => matches(row, part));
    if (value instanceof Date) return row[key] instanceof Date && (row[key] as Date).getTime() === value.getTime();
    if (value && typeof value === "object") {
      const condition = value as Row;
      if ("in" in condition) return (condition.in as unknown[]).includes(row[key]);
      if ("not" in condition) return row[key] !== condition.not;
      if ("lt" in condition) return row[key] !== null && (row[key] as Date) < (condition.lt as Date);
      if ("gte" in condition) return (row[key] as Date) >= (condition.gte as Date);
    }
    return row[key] === value;
  });
}
function fakeDb() {
  const leads: Row[] = [{ id: "l1", companyName: "甲公司", phone: null, email: null, assignedUserId: null, profile: { province: "浙江省" }, contactStatus: "PENDING_LOOKUP", contactStatusUpdatedAt: null }];
  const lookups: Row[] = []; const quotas = new Map<string, number>(); const logs: Row[] = [];
  const table = (rows: Row[]) => ({
    findUnique: vi.fn(async ({ where }: { where: Row }) => structuredClone(rows.find((row) => matches(row, where)) ?? null)),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => { const row = rows.find((entry) => matches(entry, where)); if (!row) throw new Error("missing"); return row; }),
    findFirst: vi.fn(async ({ where }: { where: Row }) => [...rows].reverse().find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: "lookup-" + (rows.length + 1), createdAt: at, finishedAt: null, ...data }; rows.push(row); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length }; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find((entry) => matches(entry, where)); if (!row) throw new Error("missing"); Object.assign(row, data); return row; }),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where)).length),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where))),
  });
  let queue = Promise.resolve();
  const db = {
    lead: table(leads), leadContactLookup: table(lookups),
    leadLookupDailyQuota: { findUnique: vi.fn(async ({ where }: { where: { quotaDate: string } }) => quotas.has(where.quotaDate) ? { used: quotas.get(where.quotaDate) } : null) },
    user: { findMany: vi.fn(async () => [{ id: "sales", role: "SALES", isActive: true, territories: [{ province: "浙江省", cities: [] }] }]) },
    customer: { findFirst: vi.fn(async () => null) }, operationLog: { create: vi.fn(async ({ data }: { data: Row }) => { logs.push(data); return data; }) },
    $executeRaw: vi.fn(async (sql: TemplateStringsArray, date: string, limit?: number) => {
      if (sql.join("").includes("UPDATE lead_hunt_tasks")) return 1;
      if (sql.join("").includes("INSERT IGNORE")) { if (!quotas.has(date)) quotas.set(date, 0); return 1; }
      if ((quotas.get(date) ?? 0) >= (limit ?? 0)) return 0;
      quotas.set(date, (quotas.get(date) ?? 0) + 1); return 1;
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const previous = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; });
      await previous; const snapshot = structuredClone({ leads, lookups, logs });
      try { return await fn(db); } catch (error) { leads.splice(0, leads.length, ...snapshot.leads); lookups.splice(0, lookups.length, ...snapshot.lookups); logs.splice(0, logs.length, ...snapshot.logs); throw error; } finally { release(); }
    }),
  };
  return { db: db as unknown as PrismaClient, leads, lookups, quotas, logs };
}
const result = (name = "甲公司", regStatus = "存续", phone = "13800001111") => parseTianyanchaResponse({ error_code: 0, result: { name, regStatus, phoneNumber: phone, creditCode: "CODE", id: 1 } });
function deps(f: ReturnType<typeof fakeDb>, value: TianyanchaLookup = result()) {
  return { prisma: f.db, configured: () => true, now: () => at, client: { lookupCompany: vi.fn(async () => value), todayCallCount: () => 0 } };
}
afterEach(() => vi.unstubAllEnvs());
describe("Lead contact lookup transactions", () => {
  it.each([null, "", "   "])("[F2] 无企业名称 %s 禁止采用，仍可驳回", async (matchedName) => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f, result("")));
    f.lookups[0].matchedName = matchedName;
    const before = structuredClone({ leads: f.leads, lookups: f.lookups, logs: f.logs });
    await expect(confirmLeadContact(admin, String(f.lookups[0].id), { decision: "ADOPT" }, deps(f))).rejects.toMatchObject({ status: 409 });
    expect({ leads: f.leads, lookups: f.lookups, logs: f.logs }).toEqual(before);
    await confirmLeadContact(admin, String(f.lookups[0].id), { decision: "REJECT" }, deps(f));
    expect(f.lookups[0].status).toBe("REJECTED");
    expect(f.leads[0]).toMatchObject({ phone: null, contactStatus: "LOOKUP_FAILED", assignedUserId: null });
  });
  it("[AUDIT-A5] a contactless admitted candidate can subsequently be looked up in the Lead pool", async () => {
    const f = fakeDb(); f.leads.splice(0);
    const candidate = { id: "candidate", taskId: "task", companyName: "甲公司", status: "NO_CONTACT", score: 88, phone: null, email: null, snippet: "甲公司扩产", phoneEvidence: null, contactName: "王经理", sourceUrl: null, keywords: [], province: "浙江省", city: null, scoreReason: "扩产" };
    Object.assign(f.db, { leadHuntTask: { findUnique: vi.fn(async () => ({ id: "task" })) }, leadHuntCandidate: { findUnique: vi.fn(async () => ({ ...candidate })), update: vi.fn(async ({ data }) => Object.assign(candidate, data)) }, $queryRaw: vi.fn(async () => []) });
    const admitted = await admitCandidates(admin, "task", ["candidate"], { prisma: f.db });
    expect(f.leads[0]).toMatchObject({ contactStatus: "PENDING_LOOKUP", phone: null, assignedUserId: null });
    await lookupLeadContact(admin, admitted.results[0].leadId!, {}, deps(f));
    expect(f.leads[0]).toMatchObject({ phone: "13800001111", assignedUserId: "sales", contactStatus: "HAS_CONTACT" });
  });
  it("[AUDIT-A5] matching active lookup fills phone and assigns by province", async () => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f));
    expect(f.leads[0]).toMatchObject({ phone: "13800001111", contactStatus: "HAS_CONTACT", assignedUserId: "sales", phoneSource: "TIANYANCHA" });
    expect(f.lookups[0]).toMatchObject({ status: "FOUND", charged: true }); expect(f.logs.length).toBeGreaterThan(0);
  });
  it("[AUDIT-T3] mismatch, including admin query override, never writes contacts", async () => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", { queryName: "乙公司" }, deps(f, result("乙公司")));
    expect(f.leads[0]).toMatchObject({ phone: null, contactStatus: "NEEDS_CONFIRM" });
    expect(f.lookups[0].status).toBe("NEEDS_CONFIRM");
  });
  it("revalidates the current company identity if a lead was renamed while the provider was running", async () => {
    const f = fakeDb(); const d = deps(f);
    d.client.lookupCompany.mockImplementationOnce(async () => { f.leads[0].companyName = "乙公司"; return result("甲公司"); });
    await lookupLeadContact(admin, "l1", {}, d);
    expect(f.leads[0]).toMatchObject({ phone: null, contactStatus: "NEEDS_CONFIRM" });
  });
  it("[AUDIT-T4] inactive mismatch is NOT_FOUND without a confirmation queue", async () => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f, result("乙公司", "注销")));
    expect(f.lookups[0]).toMatchObject({ status: "NOT_FOUND", reason: expect.stringContaining("注销") }); expect(f.leads[0].phone).toBeNull();
  });
  it("[AUDIT-A3] quota uses global configuration and returns 429 without calling the provider", async () => {
    vi.stubEnv("LEAD_TYC_DAILY_LIMIT", "1"); const f = fakeDb(); f.quotas.set(beijingQuotaDate(at), 1); const d = deps(f);
    await expect(lookupLeadContact(admin, "l1", { dailyLookupLimit: 500 }, d)).rejects.toMatchObject({ status: 429 });
    expect(d.client.lookupCompany).not.toHaveBeenCalled(); expect(f.leads[0].contactStatus).toBe("PENDING_LOOKUP");
  });
  it("[AUDIT-A4] thrown provider errors release locks and stale locks can be reclaimed", async () => {
    const f = fakeDb(); const d = deps(f); d.client.lookupCompany.mockRejectedValueOnce(new Error("network"));
    await expect(lookupLeadContact(admin, "l1", {}, d)).rejects.toMatchObject({ status: 502 });
    expect(f.leads[0].contactStatus).toBe("LOOKUP_FAILED"); expect(f.lookups[0].status).toBe("FAILED");
    Object.assign(f.leads[0], { contactStatus: "LOOKING_UP", contactStatusUpdatedAt: new Date(at.getTime() - 120_001) });
    await lookupLeadContact(admin, "l1", {}, deps(f)); expect(f.leads[0].contactStatus).toBe("HAS_CONTACT");
  });
  it("a stale provider result cannot overwrite the request that reclaimed its lock", async () => {
    const f = fakeDb(); const firstDeps = deps(f);
    let release!: (value: TianyanchaLookup) => void; let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    firstDeps.client.lookupCompany.mockImplementationOnce(() => { markStarted(); return new Promise<TianyanchaLookup>((resolve) => { release = resolve; }); });
    const first = lookupLeadContact(admin, "l1", {}, firstDeps);
    const assertion = expect(first).rejects.toMatchObject({ status: 409 });
    await started;
    await lookupLeadContact(admin, "l1", {}, { ...deps(f, result("甲公司", "存续", "13800002222")), now: () => new Date(at.getTime() + 121_000) });
    release(result()); await assertion;
    expect(f.leads[0]).toMatchObject({ phone: "13800002222", contactStatus: "HAS_CONTACT" });
  });
  it("[AUDIT-T2] changes date at Beijing midnight and mock calls use no quota or Lead contacts", async () => {
    expect(beijingQuotaDate(new Date("2026-11-06T15:59:59Z"))).toBe("2026-11-06");
    expect(beijingQuotaDate(at)).toBe("2026-11-07");
    vi.stubEnv("LEAD_TYC_MOCK", "1"); vi.stubEnv("NODE_ENV", "test");
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f, { ...result(), isMock: true }));
    expect(f.quotas.size).toBe(0); expect(f.lookups[0]).toMatchObject({ charged: false, isMock: true }); expect(f.leads[0].phone).toBeNull();
  });
  it("database quota reservation cannot exceed its limit concurrently", async () => {
    const f = fakeDb(); const outcomes = await Promise.all(Array.from({ length: 20 }, () => reserveLookupQuota(f.db, "2026-11-07", 2)));
    expect(outcomes.filter(Boolean)).toHaveLength(2); expect(f.quotas.get("2026-11-07")).toBe(2);
  });
  it("cache reuse creates a new uncharged record and does not call the provider", async () => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f));
    f.leads.push({ ...f.leads[0], id: "l2", phone: null, contactStatus: "PENDING_LOOKUP" }); const d = deps(f);
    await lookupLeadContact(admin, "l2", {}, d);
    expect(d.client.lookupCompany).not.toHaveBeenCalled(); expect(f.lookups[1]).toMatchObject({ charged: false, cacheOfLookupId: f.lookups[0].id });
  });
  it("two concurrent administrators confirming one lookup produce one success and one 409", async () => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f, result("乙公司")));
    const outcomes = await Promise.allSettled([confirmLeadContact(admin, String(f.lookups[0].id), { decision: "ADOPT" }, deps(f)), confirmLeadContact(admin, String(f.lookups[0].id), { decision: "ADOPT" }, deps(f))]);
    expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((value) => value.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect(f.leads[0]).toMatchObject({ phone: "13800001111", phoneEvidence: expect.objectContaining({ manuallyConfirmed: true }) });
  });
  it("rejects mismatches without touching the phone, and blocks simulated adoption", async () => {
    const f = fakeDb(); await lookupLeadContact(admin, "l1", {}, deps(f, result("乙公司")));
    await confirmLeadContact(admin, String(f.lookups[0].id), { decision: "REJECT" }, deps(f));
    expect(f.leads[0]).toMatchObject({ phone: null, contactStatus: "LOOKUP_FAILED" }); expect(f.lookups[0].status).toBe("REJECTED");
    expect(classifyLookup("甲公司", { ...result(), isMock: true }).status).toBe("FAILED");
  });
  it("missing token never reserves quota", async () => {
    const f = fakeDb(); await expect(lookupLeadContact(admin, "l1", {}, { ...deps(f), configured: () => false })).rejects.toMatchObject({ status: 503 });
    expect(f.db.$executeRaw).not.toHaveBeenCalled();
  });
});
