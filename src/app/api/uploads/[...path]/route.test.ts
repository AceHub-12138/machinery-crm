import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getXiaochuanViewer } = vi.hoisted(() => ({
  getXiaochuanViewer: vi.fn(),
}));

vi.mock("@/lib/agent/auth", () => ({ getXiaochuanViewer }));

import { GET } from "./route";

function requestPath(...segments: string[]) {
  return GET(
    new NextRequest(`http://localhost/api/uploads/${segments.join("/")}`),
    { params: Promise.resolve({ path: segments }) },
  );
}

describe("受保护上传文件读取", () => {
  beforeEach(() => {
    getXiaochuanViewer.mockReset();
  });

  it("独立 Agent 账号不能读取小川目录以外的业务附件", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });

    const response = await requestPath("contracts", "secret.pdf");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("独立 Agent 账号可以进入自己的小川附件读取流程", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });

    const response = await requestPath("xiaochuan", "agent-account", "agent-1", "missing.png");

    expect(response.status).toBe(404);
  });

  it("独立 Agent 账号不能读取其他账号或旧版无归属的小川附件", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });

    const otherAccount = await requestPath("xiaochuan", "agent-account", "agent-2", "secret.png");
    const legacyEmployeeUpload = await requestPath("xiaochuan", "legacy-secret.png");

    expect(otherAccount.status).toBe(403);
    expect(legacyEmployeeUpload.status).toBe(403);
  });

  it("CRM 员工仍可进入原有业务附件读取流程", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "crm", user: { id: "user-1" } });

    const response = await requestPath("contracts", "missing.pdf");

    expect(response.status).toBe(404);
  });
});
