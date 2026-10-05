import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listCustomers: vi.fn(),
  createCustomer: vi.fn(),
  isDuplicateCustomerError: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/modules/crm/customers/service", () => ({
  listCustomers: mocks.listCustomers,
  createCustomer: mocks.createCustomer,
  isDuplicateCustomerError: mocks.isDuplicateCustomerError,
}));

import { GET as legacyGet, POST as legacyPost } from "@/app/api/customers/route";
import { GET as domainGet, POST as domainPost } from "@/app/api/crm/customers/route";

const user = { id: "admin", role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" } as const;
const request = (path: string, method = "GET") => new NextRequest(`http://localhost${path}`, method === "POST" ? { method, body: "{}" } : { method });

describe("客户新旧 API 契约", () => {
  it("未登录时两个 GET 都返回 401", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await legacyGet(request("/api/customers"))).status).toBe(401);
    expect((await domainGet(request("/api/crm/customers"))).status).toBe(401);
  });

  it("服务层拒绝时两个 GET 都返回同一 403", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listCustomers.mockRejectedValue(new DomainError("无权限访问 CRM", 403));
    for (const handler of [legacyGet, domainGet]) {
      const response = await handler(request("/api/customers"));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "无权限访问 CRM" });
    }
  });

  it("非法创建日期在两个 GET 入口都返回同一 400", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listCustomers.mockRejectedValue(new DomainError("创建日期筛选格式错误", 400));
    for (const handler of [legacyGet, domainGet]) {
      const response = await handler(request("/api/customers?createdStart=2026-02-30"));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "创建日期筛选格式错误" });
    }
  });

  it("成功读取时两个 GET 透传同一服务响应", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listCustomers.mockResolvedValue({ customers: [{ id: "c1" }], pagination: { page: 1 } });
    for (const handler of [legacyGet, domainGet]) {
      const response = await handler(request("/api/customers?page=1"));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ customers: [{ id: "c1" }], pagination: { page: 1 } });
    }
  });

  it("客户重复时两个 POST 保留 409 警告契约", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.createCustomer.mockRejectedValue(new DomainError("重复客户", 409, { duplicate: { id: "c1" } }));
    for (const handler of [legacyPost, domainPost]) {
      const response = await handler(request("/api/customers", "POST"));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ warning: true, message: "重复客户", duplicate: { id: "c1" } });
    }
  });
});
