import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), lookup: vi.fn(), confirm: vi.fn(), list: vi.fn(), quota: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.user }));
vi.mock("./contact-lookup", async (original) => ({ ...await original<typeof import("./contact-lookup")>(), lookupLeadContact: mocks.lookup, confirmLeadContact: mocks.confirm, listContactLookups: mocks.list, getLookupQuota: mocks.quota }));
import { POST as lookup } from "@/app/api/crm/leads/[id]/contact-lookup/route";
import { POST as confirm } from "@/app/api/crm/leads/contact-lookups/[lookupId]/confirm/route";
import { GET as list } from "@/app/api/crm/leads/contact-lookups/route";
import { GET as quota } from "@/app/api/crm/leads/contact-lookups/quota/route";
const routes = [
  () => lookup(new NextRequest("http://localhost/api/crm/leads/l/contact-lookup", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "l" }) }),
  () => confirm(new NextRequest("http://localhost/api/crm/leads/contact-lookups/q/confirm", { method: "POST", body: '{"decision":"ADOPT"}' }), { params: Promise.resolve({ lookupId: "q" }) }),
  () => list(new NextRequest("http://localhost/api/crm/leads/contact-lookups")),
  () => quota(),
];
beforeEach(() => { vi.clearAllMocks(); for (const fn of [mocks.lookup, mocks.confirm, mocks.list, mocks.quota]) fn.mockResolvedValue({ ok: true }); });
describe("contact verification API permissions", () => {
  it.each([null, "SALES", "FOREIGN_TRADE", "WAREHOUSE", "PURCHASE", "SUPER_ADMIN"])("enforces handler authorization for %s on all four endpoints", async (role) => {
    mocks.user.mockResolvedValue(role ? { id: "u", role } : null);
    for (const route of routes) expect((await route()).status).toBe(role === null ? 401 : role === "SUPER_ADMIN" ? 200 : 403);
    if (role !== "SUPER_ADMIN") for (const fn of [mocks.lookup, mocks.confirm, mocks.list, mocks.quota]) expect(fn).not.toHaveBeenCalled();
  });
});
