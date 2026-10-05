import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getPublicSalesScreenPayload: vi.fn(),
}));

vi.mock("@/modules/screen/public-service", () => ({
  getPublicSalesScreenPayload: mocks.getPublicSalesScreenPayload,
}));

import { GET } from "@/app/api/screen/sales/[publicId]/route";

const VALID_PUBLIC_ID = "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ";

const samplePayload = {
  version: 1,
  generatedAt: "2026-09-21T08:00:00.000Z",
  displayNotice: true,
  modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
  period: { label: "2026年9月", startDate: "2026-09-01", endDate: "2026-09-21" },
  kpis: { totalCustomers: 18, periodNewCustomers: 4, todayFollowUp: 3, overdueFollowUp: 2, sevenDayFollowUp: 5, periodNewContracts: 6, periodContractAmount: "1500000.00", periodPaidAmount: "600000.00", periodUnpaidAmount: "900000.00", periodShipments: 7, unpaidContracts: 2, partialPaidContracts: 3 },
  collection: {
    totalContractAmount: "5000000.00", totalPaidAmount: "2000000.00", totalUnpaidAmount: "3000000.00", collectionRate: 40,
    targetAmount: "5000000.00", actualAmount: "1000000.00", targetRate: 20, targetVisualRate: 20,
    remainingAmount: "4000000.00", exceededAmount: "0.00", exceeded: false,
  },
  delivery: {
    summary: { shipmentCount: 42, unitCount: 55, regionCount: 2, todayDue: 1, sevenDayDue: 4, overdueDue: 2 },
    routes: [],
    reminders: { today: [], sevenDays: [], overdue: [] },
    milestones: [],
  },
};

function request(publicId: string) {
  return { params: Promise.resolve({ publicId }) } as { params: Promise<{ publicId: string }> };
}

beforeEach(() => vi.clearAllMocks());

describe("public sales screen route", () => {
  it("serves the whitelist payload with no-store and noindex headers", async () => {
    mocks.getPublicSalesScreenPayload.mockResolvedValue(samplePayload);

    const response = await GET({} as never, request(VALID_PUBLIC_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.json()).resolves.toEqual(samplePayload);
    expect(mocks.getPublicSalesScreenPayload).toHaveBeenCalledWith(VALID_PUBLIC_ID);
  });

  it("answers every unavailability with the uniform 404 screen-unavailable body", async () => {
    mocks.getPublicSalesScreenPayload.mockRejectedValue(new DomainError("大屏不可用", 404));
    const response = await GET({} as never, request(VALID_PUBLIC_ID));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "大屏不可用" });
  });

  it("does not disguise internal DomainErrors (e.g. 503 or 400) as link-unavailable 404s", async () => {
    // 数据服务内部故障必须暴露为通用 500，而不是伪装成链接失效
    mocks.getPublicSalesScreenPayload.mockRejectedValue(new DomainError("数据服务暂时不可用", 503));
    const serviceDown = await GET({} as never, request(VALID_PUBLIC_ID));
    expect(serviceDown.status).toBe(500);
    await expect(serviceDown.json()).resolves.toEqual({ error: "大屏暂时不可用" });

    mocks.getPublicSalesScreenPayload.mockRejectedValue(new DomainError("参数无效", 400));
    const badRequest = await GET({} as never, request(VALID_PUBLIC_ID));
    expect(badRequest.status).toBe(500);
    await expect(badRequest.json()).resolves.toEqual({ error: "大屏暂时不可用" });
  });

  it("hides unexpected failures behind a generic 500 without any internal detail", async () => {
    mocks.getPublicSalesScreenPayload.mockRejectedValue(new Error("prisma: table leak /root/secret"));
    const response = await GET({} as never, request(VALID_PUBLIC_ID));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "大屏暂时不可用" });
    expect(JSON.stringify(body)).not.toContain("prisma");
    expect(JSON.stringify(body)).not.toContain("/root/secret");
  });

  it("decodes the raw publicId from the dynamic segment unchanged", async () => {
    mocks.getPublicSalesScreenPayload.mockRejectedValue(new DomainError("大屏不可用", 404));
    await GET({} as never, request("abcDEF123_-xyzXYZ456qrs789tuv0000000000QQ"));
    expect(mocks.getPublicSalesScreenPayload).toHaveBeenCalledWith("abcDEF123_-xyzXYZ456qrs789tuv0000000000QQ");
  });
});
