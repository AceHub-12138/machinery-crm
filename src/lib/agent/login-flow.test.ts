import { describe, expect, it } from "vitest";
import { shouldFallbackToCrmLogin } from "@/lib/agent/login-flow";

describe("Agent 登录后的 CRM 回退规则", () => {
  it("仅当用户名不在 Agent 名单时回退 CRM", () => {
    expect(shouldFallbackToCrmLogin(401, "NOT_AGENT_ACCOUNT")).toBe(true);
    expect(shouldFallbackToCrmLogin(401, "BAD_CREDENTIALS")).toBe(false);
    expect(shouldFallbackToCrmLogin(403, "INACTIVE")).toBe(false);
    expect(shouldFallbackToCrmLogin(429, "RATE_LIMITED")).toBe(false);
  });
});
