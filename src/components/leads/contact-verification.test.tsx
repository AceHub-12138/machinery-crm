import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactLookupManager, ContactVerificationCard } from "./contact-verification";
import type { HumanLeadDetail } from "@/modules/crm/leads/types";
const lead = { id: "l", phone: null, phoneSource: null, contactStatus: "PENDING_LOOKUP", phoneEvidence: { rawResponse: "private-evidence", excerpt: "网页电话证据", sharedPhoneLeadCount: 2 }, contactLookups: [] } as unknown as HumanLeadDetail;
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: vi.fn(react.useState) };
});
afterEach(() => vi.mocked(useState).mockClear());
describe("contact verification role views", () => {
  it.each([null, "", "   ", "乙公司"])("[F2] 待确认结果名称为 %s 时正确禁用采用，并保留驳回", (matchedName) => {
    vi.mocked(useState).mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([[{ id: "lookup", matchedName, phones: ["13800001111"], emails: [], isMock: false }], vi.fn()]);
    const html = renderToStaticMarkup(createElement(ContactLookupManager, { status: "NEEDS_CONFIRM", onStatus() {}, selected: [], onRefresh() {} }));
    const adopt = html.match(/<button\b[^>]*>确认是同一家，采用<\/button>/)?.[0];
    expect(adopt).toBeDefined();
    expect(adopt?.includes('disabled=""')).toBe(!matchedName?.trim());
    expect(html.match(/<button\b[^>]*>不是同一家，驳回<\/button>/)?.[0]).not.toContain('disabled=""');
  });
  it("sales see source summaries, without lookup controls or raw evidence", () => {
    const html = renderToStaticMarkup(createElement(ContactVerificationCard, { lead, isAdmin: false, onRefresh() {} }));
    expect(html).toContain("疑似代账/共用电话");
    expect(html).not.toContain("指定查询全称"); expect(html).not.toContain("private-evidence");
    expect(html).not.toContain("反查历史");
  });
  it("administrators can specify a full query name and inspect verification evidence", () => {
    const html = renderToStaticMarkup(createElement(ContactVerificationCard, { lead, isAdmin: true, onRefresh() {} }));
    expect(html).toContain("指定查询全称"); expect(html).toContain("网页电话证据"); expect(html).toContain("反查历史");
  });
});
