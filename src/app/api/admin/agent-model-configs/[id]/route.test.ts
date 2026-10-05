import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const config = {
    id: "config-1",
    name: "主配置",
    baseUrl: "https://example.com/v1",
    model: "old-model",
    apiKeyCipher: "cipher",
    apiKeyHint: "****1234",
    isActive: true,
    createdAt: new Date("2026-09-04T00:00:00Z"),
    updatedAt: new Date("2026-09-04T00:00:00Z"),
  };
  const agentModelConfig = {
    findUnique: vi.fn(async () => ({ ...config })),
    findFirst: vi.fn(async () => ({ ...config })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(config, data, { updatedAt: new Date() });
      return { ...config };
    }),
  };
  const prisma = {
    agentModelConfig,
    $transaction: vi.fn(async (callback: (tx: { agentModelConfig: typeof agentModelConfig }) => unknown) =>
      callback({ agentModelConfig })),
  };
  return { config, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/permissions", () => ({
  getSessionUser: vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" })),
  isSuperAdmin: vi.fn(() => true),
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: vi.fn(async () => undefined) }));

import { PATCH } from "./route";
import {
  clearModelConfigCache,
  encryptApiKey,
  readActiveModelConfigCached,
} from "@/lib/agent/model-config-store";

describe("编辑生效中的 Agent 模型配置", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret";
    Object.assign(mocks.config, {
      model: "old-model",
      isActive: true,
      apiKeyCipher: encryptApiKey("sk-test"),
    });
    clearModelConfigCache();
  });

  it("保存后运行时下一次读取立即使用新模型", async () => {
    await readActiveModelConfigCached();

    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/agent-model-configs/config-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "new-model" }),
      }),
      { params: Promise.resolve({ id: "config-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(readActiveModelConfigCached()).resolves.toMatchObject({ model: "new-model" });
  });
});
