import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  readSalesScreenShare: vi.fn(),
  createOrRotateSalesScreenShare: vi.fn(),
  revokeSalesScreenShare: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/modules/screen/share-service", () => ({
  readSalesScreenShare: mocks.readSalesScreenShare,
  createOrRotateSalesScreenShare: mocks.createOrRotateSalesScreenShare,
  revokeSalesScreenShare: mocks.revokeSalesScreenShare,
}));

import { DELETE, GET, POST } from "@/app/api/system/sales-screen/share/route";

const admin = { id: "admin", role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" } as const;

const activeView = {
  share: {
    version: 1,
    publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ",
    createdAt: "2026-09-21T08:00:00.000Z",
    rotatedAt: null,
    revokedAt: null,
  },
  path: "/screen/sales/q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ?kiosk=1",
};

const revokedView = {
  share: { version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: "2026-09-21T09:00:00.000Z" },
  path: null,
};

function request(method: "GET" | "POST" | "DELETE", headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/system/sales-screen/share", { method, headers });
}

beforeEach(() => vi.clearAllMocks());

describe("sales screen share route", () => {
  it("returns 401 for unauthenticated GET, POST and DELETE", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST()).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
    expect(mocks.readSalesScreenShare).not.toHaveBeenCalled();
  });

  it("maps the service 403 DomainError to HTTP 403 with the Chinese message", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.readSalesScreenShare.mockRejectedValue(new DomainError("无权限管理展厅大屏共享链接", 403));

    const response = await GET();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "无权限管理展厅大屏共享链接" });
  });

  it("maps validation failures to 400 and unexpected errors to a generic 500 without internal details", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);

    mocks.createOrRotateSalesScreenShare.mockRejectedValueOnce(new DomainError("共享状态格式无效", 400));
    const invalid = await POST();
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "共享状态格式无效" });

    mocks.revokeSalesScreenShare.mockRejectedValueOnce(new Error("db connection leaked secret"));
    const failed = await DELETE();
    expect(failed.status).toBe(500);
    const body = await failed.json();
    expect(body).toEqual({ error: "共享链接操作失败" });
    expect(JSON.stringify(body)).not.toContain("db connection leaked secret");
  });

  it("returns only the relative path for GET, POST and DELETE successes", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.readSalesScreenShare.mockResolvedValue(activeView);
    mocks.createOrRotateSalesScreenShare.mockResolvedValue(activeView);
    mocks.revokeSalesScreenShare.mockResolvedValue(revokedView);

    const got = await GET();
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as typeof activeView;
    expect(gotBody).toEqual(activeView);

    const posted = await POST();
    expect(posted.status).toBe(200);
    const postedBody = (await posted.json()) as typeof activeView;
    expect(postedBody).toEqual(activeView);
    expect(mocks.createOrRotateSalesScreenShare).toHaveBeenCalledWith(admin);

    const deleted = await DELETE();
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as typeof revokedView;
    expect(deletedBody).toEqual(revokedView);

    for (const body of [gotBody, postedBody, deletedBody]) {
      if (body.path !== null) {
        expect(body.path.startsWith("/")).toBe(true);
        expect(body.path).toMatch(/\?kiosk=1$/);
        expect(body.path).not.toMatch(/^https?:\/\//i);
      }
    }
  });

  it("never lets Host, Origin or proxy headers influence the returned path", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.readSalesScreenShare.mockResolvedValue(activeView);

    const spoofedRequest = request("GET", {
      host: "evil.example",
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });
    // 处理器签名无参；这里显式传入伪造头请求，证明路径完全不受其影响
    const spoofed = await (GET as unknown as (req: NextRequest) => Promise<Response>)(spoofedRequest);

    expect(spoofed.status).toBe(200);
    const serialized = JSON.stringify(await spoofed.json());
    expect(serialized).not.toContain("evil.example");
    expect(serialized).toContain('"/screen/sales/');
  });
});
