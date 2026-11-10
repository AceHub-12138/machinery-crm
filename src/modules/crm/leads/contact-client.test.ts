import { describe, expect, it, vi } from "vitest";
import { runContactLookups } from "./contact-client";
describe("sequential contact lookup UI", () => {
  it("requests one lead at a time and stops immediately at 429", async () => {
    let active = 0; let maximum = 0;
    const request = vi.fn(async () => {
      active += 1; maximum = Math.max(maximum, active);
      await Promise.resolve(); active -= 1;
      return new Response(JSON.stringify({ reason: "额度已用完" }), { status: request.mock.calls.length === 2 ? 429 : 200 });
    });
    const progress = vi.fn();
    await runContactLookups(["a", "b", "c"], progress, request);
    expect(maximum).toBe(1); expect(request).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ id: "b", status: 429 }), 2, 3);
  });
  it("stops at the first unconfigured response", async () => {
    const request = vi.fn(async () => Response.json({ error: "天眼查未配置" }, { status: 503 }));
    const progress = vi.fn();
    await runContactLookups(["first", "second"], progress, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({ id: "first", status: 503, message: "天眼查未配置，已停止批量反查" }, 1, 2);
  });
  it("enforces the 20 lead maximum before any request", async () => {
    const request = vi.fn(); await expect(runContactLookups(Array(21).fill("x"), vi.fn(), request)).rejects.toThrow("1~20");
    expect(request).not.toHaveBeenCalled();
  });
});
