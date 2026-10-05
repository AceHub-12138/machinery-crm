import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const account = {
    id: "account-1",
    username: "agent-review",
    displayName: "本地验收账号",
    remark: null,
    dailyQuota: 10,
    sessionVersion: 3,
    isActive: true,
    createdAt: new Date("2026-09-04T00:00:00Z"),
  };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...account,
    sessionVersion: data.sessionVersion ? account.sessionVersion + 1 : account.sessionVersion,
  }));
  const agentAccount = {
    findUnique: vi.fn(async () => ({ ...account })),
    update,
  };
  const prisma = {
    agentAccount,
    $transaction: vi.fn(async (callback: (tx: { agentAccount: typeof agentAccount }) => unknown) =>
      callback({ agentAccount })),
  };
  return { prisma, update };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/permissions", () => ({
  getSessionUser: vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" })),
  isSuperAdmin: vi.fn(() => true),
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: vi.fn(async () => undefined) }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed-password") } }));

import { PATCH } from "./route";

describe("重置 Agent 独立账号密码", () => {
  beforeEach(() => {
    mocks.update.mockClear();
  });

  it("递增会话版本，使旧 Cookie 在下一次请求时失效", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/agent-accounts/account-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "new-password" }),
      }),
      { params: Promise.resolve({ id: "account-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        passwordHash: "hashed-password",
        sessionVersion: { increment: 1 },
      }),
    }));
  });
});
