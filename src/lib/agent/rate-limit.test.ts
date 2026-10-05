import { describe, expect, it } from "vitest";
import { checkXiaochuanRateLimit, resetXiaochuanRateLimitForTest } from "@/lib/agent/rate-limit";

describe("checkXiaochuanRateLimit", () => {
  it("限额内放行，超限拒绝并给出等待秒数", () => {
    resetXiaochuanRateLimitForTest("user-a");
    expect(checkXiaochuanRateLimit("user-a", 2).allowed).toBe(true);
    expect(checkXiaochuanRateLimit("user-a", 2).allowed).toBe(true);
    const blocked = checkXiaochuanRateLimit("user-a", 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("不同用户互不影响", () => {
    resetXiaochuanRateLimitForTest("user-b");
    resetXiaochuanRateLimitForTest("user-c");
    expect(checkXiaochuanRateLimit("user-b", 1).allowed).toBe(true);
    expect(checkXiaochuanRateLimit("user-b", 1).allowed).toBe(false);
    expect(checkXiaochuanRateLimit("user-c", 1).allowed).toBe(true);
  });

  it("测试重置函数清空计数", () => {
    resetXiaochuanRateLimitForTest("user-d");
    expect(checkXiaochuanRateLimit("user-d", 1).allowed).toBe(true);
    resetXiaochuanRateLimitForTest("user-d");
    expect(checkXiaochuanRateLimit("user-d", 1).allowed).toBe(true);
  });
});
