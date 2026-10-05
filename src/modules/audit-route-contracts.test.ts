import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), listOperationLogs: vi.fn() }));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/modules/system/audit/service", () => ({ listOperationLogs: mocks.listOperationLogs }));

import { GET as legacyGet } from "@/app/api/operation-logs/route";
import { GET as domainGet } from "@/app/api/system/audit/route";

const request = (path: string) => new NextRequest(`http://localhost${path}`);
const user = { id: "admin", role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" } as const;

describe("审计新旧 API 契约", () => {
  it("未登录时两个入口都返回 401", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await legacyGet(request("/api/operation-logs"))).status).toBe(401);
    expect((await domainGet(request("/api/system/audit"))).status).toBe(401);
  });

  it("服务层拒绝时两个入口都返回同一 403", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listOperationLogs.mockRejectedValue(new DomainError("无权查看操作日志", 403));
    for (const handler of [legacyGet, domainGet]) {
      const response = await handler(request("/api/operation-logs"));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "无权查看操作日志" });
    }
  });

  it("成功读取时两个入口透传同一数组响应", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listOperationLogs.mockResolvedValue([{ id: "log1", action: "CREATE_CUSTOMER" }]);
    for (const handler of [legacyGet, domainGet]) {
      const response = await handler(request("/api/operation-logs?pageSize=20"));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([{ id: "log1", action: "CREATE_CUSTOMER" }]);
    }
  });
});
