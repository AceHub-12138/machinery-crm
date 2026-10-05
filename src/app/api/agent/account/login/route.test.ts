import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  compare: vi.fn(),
  setAgentAccountCookie: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { agentAccount: { findUnique: mocks.findUnique } },
}));
vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare },
}));
vi.mock("@/lib/agent/auth", () => ({
  setAgentAccountCookie: mocks.setAgentAccountCookie,
}));

import { POST } from "./route";

function login(username: string, password = "password-123") {
  return POST(new Request("http://localhost/api/agent/account/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }));
}

describe("Agent 独立账号登录判定", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.compare.mockReset();
    mocks.setAgentAccountCookie.mockReset();
  });

  it("不在 Agent 名单的 CRM 用户可重复回退登录且不会被 Agent 限流", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const username = `crm-${Date.now()}@example.test`;

    const responses = [];
    for (let index = 0; index < 6; index += 1) responses.push(await login(username));

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({ code: "NOT_AGENT_ACCOUNT" });
    }
  });

  it("Agent 名单内账号密码错误时明确拒绝，不伪装成非 Agent 账号", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "agent-1",
      username: "agent-1",
      passwordHash: "hash",
      displayName: "验收账号",
      isActive: true,
    });
    mocks.compare.mockResolvedValue(false);

    const response = await login("agent-1", "wrong-password");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "BAD_CREDENTIALS" });
  });
});
