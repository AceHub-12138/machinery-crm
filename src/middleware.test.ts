import { beforeEach, describe, expect, it, vi } from "vitest";

// auth() 以恒等替换，直接拿到 middleware 内部 handler 以便单测
vi.mock("@/lib/auth", () => ({
  auth: (handler: (req: unknown) => unknown) => handler,
}));

import middleware from "./middleware";

type FakeReq = {
  nextUrl: URL;
  auth: { user: { role: string } } | null;
  url: string;
};

function fakeReq(path: string, role: string | null): FakeReq {
  const url = `http://localhost${path}`;
  return {
    nextUrl: new URL(url),
    auth: role === null ? null : { user: { role } },
    url,
  };
}

async function runMiddleware(path: string, role: string | null): Promise<Response> {
  const handler = middleware as unknown as (req: FakeReq) => Promise<Response>;
  return handler(fakeReq(path, role));
}

beforeEach(() => vi.clearAllMocks());

describe("sales screen share middleware protection", () => {
  it("blocks non SUPER_ADMIN accounts from /api/system/sales-screen/share with 403", async () => {
    const response = await runMiddleware("/api/system/sales-screen/share", "SALES");
    expect(response.status).toBe(403);
  });

  it("keeps the existing SUPER_ADMIN gate on /api/system/settings", async () => {
    const response = await runMiddleware("/api/system/settings", "SALES");
    expect(response.status).toBe(403);
  });

  it("lets SUPER_ADMIN pass through to the share API", async () => {
    const response = await runMiddleware("/api/system/sales-screen/share", "SUPER_ADMIN");
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBeGreaterThanOrEqual(300);
  });

  it("still redirects unauthenticated requests to login", async () => {
    const response = await runMiddleware("/api/system/sales-screen/share", null);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/login");
  });
});

describe("public sales screen middleware allowance", () => {
  it("lets unauthenticated visitors reach the public screen page path", async () => {
    const response = await runMiddleware("/screen/sales/q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ", null);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets unauthenticated visitors reach the public screen data API", async () => {
    const response = await runMiddleware("/api/screen/sales/q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ", null);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps every other /api/screen path behind login", async () => {
    const response = await runMiddleware("/api/screen/evil", null);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("keeps the existing CRM dashboard APIs behind login", async () => {
    for (const path of ["/api/dashboard", "/api/crm/dashboard"]) {
      const response = await runMiddleware(path, null);
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.headers.get("location")).toContain("/login");
    }
  });

  it("keeps the platform root and admin area behind login", async () => {
    for (const path of ["/dashboard", "/admin"]) {
      const response = await runMiddleware(path, null);
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.headers.get("location")).toContain("/login");
    }
  });
});
