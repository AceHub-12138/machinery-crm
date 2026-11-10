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
