import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeadProfilePresentation } from "@/components/leads/lead-profile-presentation";

describe("LeadProfilePresentation", () => {
  it("画像不存在时显示明确空态", () => {
    expect(renderToStaticMarkup(<LeadProfilePresentation profile={null} />))
      .toContain("暂无 AI 画像");
  });

  it("只有 summary 时显示客户概况且不输出 JSON 或 pre", () => {
    const html = renderToStaticMarkup(<LeadProfilePresentation profile={{ summary: "客户计划更新机床。" }} />);
    expect(html).toContain("客户概况");
    expect(html).toContain("客户计划更新机床。");
    expect(html).not.toContain("&quot;summary&quot;");
    expect(html).not.toContain("<pre");
  });

  it.each([
    ["空对象", {}],
    ["非预期数组", []],
    ["非预期字段类型", { summary: 42, evidence: "不是数组", riskFlags: [null, 7] }],
  ])("%s 安全显示空态", (_label, profile) => {
    expect(renderToStaticMarkup(<LeadProfilePresentation profile={profile} />))
      .toContain("暂无 AI 画像");
  });

  it("evidence 数组直接渲染为业务列表", () => {
    const html = renderToStaticMarkup(<LeadProfilePresentation profile={{ evidence: ["企业正在扩产", "出现设备采购需求"] }} />);
    expect(html).toContain("重点依据");
    expect(html).toContain("<li>企业正在扩产</li>");
    expect(html).toContain("<li>出现设备采购需求</li>");
    expect(html).not.toContain('[&quot;企业正在扩产&quot;');
  });
});
