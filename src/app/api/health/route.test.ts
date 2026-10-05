import { afterEach, expect, it, vi } from "vitest";
const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: transaction } }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.resetModules(); });

it("并发探活共用探测，完成后缓存五秒；只返回状态", async () => {
  vi.useFakeTimers();
  let resolve!: (healthy: boolean) => void;
  transaction.mockReturnValueOnce(new Promise<boolean>((done) => { resolve = done; })).mockResolvedValue(true);
  const { GET } = await import("./route");
  const first = GET();
  vi.advanceTimersByTime(6_000);
  const second = GET();
  expect(transaction).toHaveBeenCalledTimes(1);
  resolve(true);
  for (const response of await Promise.all([first, second])) {
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  }
  await GET();
  expect(transaction).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5_001);
  await GET();
  expect(transaction).toHaveBeenCalledTimes(2);
});

it("数据库故障返回 503，不泄露数据库异常", async () => {
  transaction.mockRejectedValue(new Error("mysql://user:secret@internal-host/db"));
  const { GET } = await import("./route");
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "degraded" });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 1_000, timeout: 3_000 });
});
