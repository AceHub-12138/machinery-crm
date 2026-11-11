// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LeadHunterClient } from "./lead-hunter-client";

it("已入池且有 leadId 的候选提供当前页查看线索，来源仍新窗口打开", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const task = { id: "task", status: "done", config: { goal: "测试任务" }, createdAt: "2026-11-10", _count: { candidates: 3 }, admittedCount: 1 };
  vi.stubGlobal("fetch", async (url: string) => Response.json(url.endsWith("/task") ? {
    task: { ...task, candidates: [
      { id: "a", companyName: "已入池甲", status: "ADMITTED", leadId: "lead-123", sourceUrl: "https://example.com/acceptance-source" },
      { id: "b", companyName: "未入池乙", status: "NO_CONTACT", leadId: "other" },
      { id: "c", companyName: "无关联丙", status: "ADMITTED", leadId: null },
    ] }, stats: {},
  } : { tasks: [task] }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LeadHunterClient />));
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "查看详情")!.click());
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
    const leadLinks = links.filter(a => a.textContent === "查看线索");
    expect(leadLinks).toHaveLength(1);
    expect(leadLinks[0].getAttribute("href")).toBe("/leads/lead-123");
    expect(leadLinks[0].getAttribute("target")).toBeNull();
    const source = links.find(a => a.textContent === "已入池甲")!;
    expect(source.getAttribute("href")).toBe("https://example.com/acceptance-source");
    expect(source.title).toBe("打开来源网页");
    expect(source.target).toBe("_blank");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
