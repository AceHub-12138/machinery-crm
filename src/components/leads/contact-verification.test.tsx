import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContactVerificationCard } from "./contact-verification";
import type { HumanLeadDetail } from "@/modules/crm/leads/types";
const lead = { id: "l", phone: null, phoneSource: null, contactStatus: "PENDING_LOOKUP", phoneEvidence: { rawResponse: "private-evidence", sharedPhoneLeadCount: 2 }, contactLookups: [] } as unknown as HumanLeadDetail;
describe("contact verification role views", () => {
  it("sales see source summaries, without lookup controls or raw evidence", () => {
    const html = renderToStaticMarkup(createElement(ContactVerificationCard, { lead, isAdmin: false, onRefresh() {} }));
    expect(html).toContain("疑似代账/共用电话");
    expect(html).not.toContain("指定查询全称"); expect(html).not.toContain("private-evidence");
    expect(html).not.toContain("反查历史");
  });
  it("administrators can specify a full query name and inspect verification evidence", () => {
    const html = renderToStaticMarkup(createElement(ContactVerificationCard, { lead, isAdmin: true, onRefresh() {} }));
    expect(html).toContain("指定查询全称"); expect(html).toContain("private-evidence"); expect(html).toContain("反查历史");
  });
});
