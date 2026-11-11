// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LeadListClient } from "./lead-list-client";

vi.mock("@/components/motion/MotionPage", () => ({ MotionPage: ({ children }: React.PropsWithChildren) => children }));
vi.mock("next/link", () => ({ default: ({ children }: React.PropsWithChildren) => children }));
const list = vi.hoisted(() => vi.fn());
vi.mock("@/modules/crm/leads/client", () => ({
  loadHumanLeadList: list, loadLeadAssignees: async () => [],
}));

it.each([
  [503, { error: "天眼查未配置" }, "天眼查未配置"],
  [200, { status: "NOT_FOUND" }, "反查无果"],
] as const)("retains the row result after table remount (%i)", async (status, payload, message) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("/contact-lookup") ? Response.json(payload, { status }) : Response.json({ used: 0, limit: 1 }));
  const data = {
    items: [{ id: "a", companyName: "验收测试甲", reviewStatus: "PENDING", createdAt: "2026-01-01" }],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  };
  let finishRefresh!: () => void;
  list.mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise(resolve => {
    finishRefresh = () => resolve(data);
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LeadListClient canFilterAssignee />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const lookup = host.querySelector<HTMLButtonElement>("tbody button");
    expect(lookup).toBeTruthy();
    await act(async () => lookup!.click());
    expect(host.querySelector("table")).toBeNull();
    await act(async () => finishRefresh());
    expect(host.querySelector("tbody button")).not.toBe(lookup);
    expect(host.querySelector('tbody [role="status"]')?.textContent).toBe(message);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("D3 keeps a named result when the lead leaves the filter, then clears it on filter change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("/contact-lookup")
    ? Response.json({ status: "FAILED", reason: "模拟数据，不可采用", isMock: true })
    : Response.json({ used: 0, limit: 20 }));
  let finished = false;
  list.mockImplementation(async (params: URLSearchParams) => ({
    items: finished && params.get("contactStatus") === "PENDING_LOOKUP" ? [] : [{
      id: "a", companyName: "验收测试甲", reviewStatus: "PENDING", createdAt: "2026-01-01",
      contactStatus: finished ? "LOOKUP_FAILED" : "PENDING_LOOKUP",
      latestContactLookup: finished ? { status: "FAILED", reason: "模拟数据，不可采用", isMock: true, createdAt: "2026-01-01" } : null,
    }],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  const tab = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="联系方式核验筛选"] button')].find(b => b.textContent === text)!;
  try {
    await act(async () => root.render(<LeadListClient canFilterAssignee />));
    await act(settle);
    await act(async () => tab("待反查").click());
    await act(settle);
    finished = true;
    await act(async () => host.querySelector<HTMLButtonElement>("tbody button")!.click());
    expect(host.querySelector("tbody")).toBeNull();
    expect(host.textContent).toContain('验收测试甲：模拟数据，不可采用，已移至“反查无果”');
    await act(async () => tab("反查无果").click());
    await act(settle);
    expect(host.textContent).not.toContain('已移至“反查无果”');
    expect(host.querySelector("tbody")?.textContent).toContain("最近反查：反查失败 · 模拟数据，不可采用");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("D3 preserves batch progress after refresh and clears single results on pagination", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("/contact-lookup")
    ? Response.json({ status: "FAILED", reason: "模拟数据，不可采用", isMock: true })
    : Response.json({ used: 0, limit: 20 }));
  list.mockImplementation(async () => ({
    items: [{ id: "a", companyName: "验收测试甲", reviewStatus: "PENDING", createdAt: "2026-01-01", contactStatus: "PENDING_LOOKUP" }],
    pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    await act(async () => root.render(<LeadListClient canFilterAssignee />));
    await act(settle);
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "待反查")!.click());
    await act(settle);
    await act(async () => host.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.click());
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith("逐条反查已选"))!.click());
    expect(host.querySelector("tbody")).not.toBeNull();
    expect(host.textContent).toContain("1/1：模拟数据，不可采用");
    await act(async () => host.querySelector<HTMLButtonElement>("tbody button")!.click());
    expect(host.textContent).not.toContain("1/1：");
    expect(host.textContent).toContain("验收测试甲：模拟数据，不可采用");
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "下一页")!.click());
    await act(settle);
    expect(host.textContent).not.toContain("验收测试甲：模拟数据，不可采用");
    expect(host.textContent).not.toContain("1/1：");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
