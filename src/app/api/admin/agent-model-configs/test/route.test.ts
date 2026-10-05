import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(async () => ({
    id: "config-1",
    baseUrl: "https://old.example.com/v1",
    model: "old-model",
    apiKeyCipher: "encrypted-key",
  })),
  decryptApiKey: vi.fn(() => "sk-stored"),
  testModelConnection: vi.fn(async () => ({ ok: true, message: "连接成功" })),
}));

vi.mock("@/lib/db", () => ({
  prisma: { agentModelConfig: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/permissions", () => ({
  getSessionUser: vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" })),
  isSuperAdmin: vi.fn(() => true),
}));
vi.mock("@/lib/agent/model-config-store", () => ({
  decryptApiKey: mocks.decryptApiKey,
  testModelConnection: mocks.testModelConnection,
}));

import { POST } from "./route";

describe("测试已保存的 Agent 模型配置", () => {
  beforeEach(() => {
    mocks.testModelConnection.mockClear();
  });

  it("保留旧 Key 时使用编辑表单中的新地址和新模型", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/agent-model-configs/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "config-1",
        baseUrl: "https://new.example.com/v1",
        model: "new-model",
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.testModelConnection).toHaveBeenCalledWith({
      baseUrl: "https://new.example.com/v1",
      apiKey: "sk-stored",
      model: "new-model",
    });
  });
});
