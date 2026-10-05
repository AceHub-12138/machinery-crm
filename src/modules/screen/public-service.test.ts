import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";

vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
    },
    shipment: {
      count: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    customer: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/modules/crm/dashboard/service", () => ({
  getCrmDashboard: vi.fn(),
}));

vi.mock("@/modules/crm/sales-targets/service", () => ({
  listSalesTargets: vi.fn(),
  parseSalesTargetPeriod: vi.fn(() => ({
    periodType: "MONTH",
    periodYear: 2026,
    periodIndex: 9,
    start: new Date(2026, 8, 1),
    end: new Date(2026, 9, 1),
    label: "2026年9月",
  })),
}));

const { getPublicSalesScreenPayload } = await import("./public-service");
const { prisma } = await import("@/lib/db");
const { getCrmDashboard } = await import("@/modules/crm/dashboard/service");
const { listSalesTargets } = await import("@/modules/crm/sales-targets/service");

const VALID_PUBLIC_ID = "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ";
const FIXED_NOW = new Date("2026-09-21T08:00:00.000Z");
const fixedNow = () => FIXED_NOW;

function mockSettingRows(shareValue: unknown, configValue: unknown) {
  (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === "salesScreenShare") return { key: where.key, value: shareValue };
    if (where.key === "salesScreen") return { key: where.key, value: configValue };
    return null;
  });
}

// 依据 getCrmDashboard 真实返回形状构造的最小全公司数据
function mockDashboard() {
  return {
    range: { preset: "month", start: new Date(2026, 8, 1), end: new Date(2026, 8, 22), startDate: "2026-09-01", endDate: "2026-09-21" },
    stats: {
      totalCustomers: 18,
      todayFollowUp: 3,
      overdueFollowUp: 2,
      sevenDayFollowUp: 5,
      periodNewCustomers: 4,
      periodNewContracts: 6,
      periodContractAmount: 300000,
      periodPaidAmount: 120000,
      periodUnpaidAmount: 180000,
      periodShipments: 7,
      totalContractAmount: 1000000,
      totalPaidAmount: 400000,
      totalUnpaidAmount: 600000,
      unpaidContracts: 2,
      partialPaidContracts: 3,
      todayShipmentDue: 1,
      sevenDayShipmentDue: 4,
      overdueShipmentDue: 2,
    },
    shipmentReminders: {
      today: [{
        id: "contract-1",
        contractNo: "HT-2026-001",
        estimatedShipmentDate: new Date("2026-09-21T00:00:00.000Z"),
        equipmentName: "数控机床",
        equipmentModel: "CK6150",
        customer: { id: "cust-1", companyName: "某公司" },
      }],
      sevenDays: [],
      overdue: [],
    },
  };
}

// 服务内部对 customer.findMany 有两类调用：distinct 省份统计 与 提醒行位置补查
function mockBusinessQueries() {
  (prisma.shipment.count as ReturnType<typeof vi.fn>).mockResolvedValue(42);
  (prisma.shipment.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { quantity: 55 } });
  (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: { distinct?: string[]; where?: { id?: { in?: string[] } } }) => {
    if (args.distinct) {
      return [{ province: "山东省滕州市" }, { province: "江苏省" }, { province: null }, { province: "不存在的省" }];
    }
    const ids = args.where?.id?.in ?? [];
    if (ids.includes("cust-1")) {
      return [{ id: "cust-1", province: "山东省", city: "青岛市" }];
    }
    return [];
  });
  (prisma.shipment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      shipmentDate: new Date("2026-09-10T00:00:00.000Z"),
      shipmentStatus: "SHIPPED",
      quantity: 2,
      contract: { contractNo: "HT-2026-001", equipmentName: "数控机床", equipmentModel: "CK6150", customer: { province: "山东省", city: "济南市" } },
    },
    {
      shipmentDate: new Date("2026-09-11T00:00:00.000Z"),
      shipmentStatus: "PARTIAL_SHIPPED",
      quantity: 1,
      contract: { contractNo: "HT-2026-002", equipmentName: "铣床", equipmentModel: "X6140", customer: { province: "不存在的省", city: null } },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public sales screen access guard", () => {
  it("rejects malformed publicId with a uniform unavailability error before any data access", async () => {
    for (const bad of ["", "short", "../etc/passwd", `${VALID_PUBLIC_ID}x`, "!".repeat(43)]) {
      await expect(getPublicSalesScreenPayload(bad)).rejects.toMatchObject({
        message: "大屏不可用",
        status: 404,
      });
    }

    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(prisma.shipment.count).not.toHaveBeenCalled();
    expect(prisma.shipment.findMany).not.toHaveBeenCalled();
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(getCrmDashboard).not.toHaveBeenCalled();
    expect(listSalesTargets).not.toHaveBeenCalled();
  });

  it("rejects non-string publicId inputs", async () => {
    for (const bad of [undefined, null, 123, {}]) {
      await expect(getPublicSalesScreenPayload(bad as unknown as string)).rejects.toBeInstanceOf(DomainError);
    }
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });
});

describe("public sales screen availability gate", () => {
  const enabledConfig = {
    version: 1,
    enabled: true,
    modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
    multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 },
    privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: true },
  };

  async function expectUnavailable(shareValue: unknown, configValue: unknown, publicId = VALID_PUBLIC_ID) {
    mockSettingRows(shareValue, configValue);

    await expect(getPublicSalesScreenPayload(publicId)).rejects.toMatchObject({ message: "大屏不可用", status: 404 });
    // 不可用判定后绝不触碰业务数据
    expect(getCrmDashboard).not.toHaveBeenCalled();
    expect(listSalesTargets).not.toHaveBeenCalled();
    expect(prisma.shipment.findMany).not.toHaveBeenCalled();
  }

  it("is unavailable when the screen is disabled even if the link is valid", async () => {
    await expectUnavailable(
      { version: 1, publicId: VALID_PUBLIC_ID, createdAt: "2026-09-20T08:00:00.000Z", rotatedAt: null, revokedAt: null },
      { ...enabledConfig, enabled: false }
    );
  });

  it("is unavailable when the link was revoked or never created", async () => {
    await expectUnavailable(
      { version: 1, publicId: null, createdAt: "2026-09-20T08:00:00.000Z", rotatedAt: null, revokedAt: "2026-09-21T00:00:00.000Z" },
      enabledConfig
    );
    await expectUnavailable(null, enabledConfig);
  });

  it("is unavailable for a stale publicId from before a rotation", async () => {
    await expectUnavailable(
      { version: 1, publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nR", createdAt: "2026-09-20T08:00:00.000Z", rotatedAt: "2026-09-21T00:00:00.000Z", revokedAt: null },
      enabledConfig
    );
  });
});

describe("public sales screen payload", () => {
  const activeShare = { version: 1, publicId: VALID_PUBLIC_ID, createdAt: "2026-09-20T08:00:00.000Z", rotatedAt: null, revokedAt: null };
  const multiplierConfig = {
    version: 1 as const,
    enabled: true,
    modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
    multipliers: { amount: 5, customerCount: 1, contractCount: 1, shipmentCount: 1 },
    privacy: { contractNumberMode: "masked" as const, addressLevel: "provinceCity" as const, showDisplayNotice: true },
  };

  it("serves real CRM data through the step-2 whitelist transform for a valid link", async () => {
    mockSettingRows(activeShare, multiplierConfig);
    (getCrmDashboard as ReturnType<typeof vi.fn>).mockResolvedValue(mockDashboard());
    (listSalesTargets as ReturnType<typeof vi.fn>).mockResolvedValue({
      period: { label: "2026年9月" },
      targets: [
        { id: "target-1", salesUserId: null, metric: "CONTRACT_AMOUNT", amount: "1000000.00", targetAmount: "1000000.00", actualAmount: "200000.00" },
        { id: "target-2", salesUserId: "sales-1", metric: "CONTRACT_AMOUNT", amount: "10.00", targetAmount: "10.00", actualAmount: "1.00" },
      ],
    });
    mockBusinessQueries();

    const requestClock = vi.fn()
      .mockReturnValueOnce(FIXED_NOW)
      .mockReturnValue(new Date("2026-10-01T00:00:00.000Z"));
    const payload = await getPublicSalesScreenPayload(VALID_PUBLIC_ID, { now: requestClock });

    // 顶层只允许白名单分组
    expect(Object.keys(payload).sort()).toEqual(["collection", "delivery", "displayNotice", "generatedAt", "kpis", "modules", "period", "version"].sort());
    expect(payload.version).toBe(1);
    // 即使后续时钟已经跨月，生成时间仍必须与本次请求的数据快照使用同一时刻
    expect(payload.generatedAt).toBe("2026-09-21T08:00:00.000Z");
    expect(payload.modules).toEqual(multiplierConfig.modules);

    // 固定当前月口径
    expect(payload.period.label).toBe("2026年9月");

    // 金额经过第 2 步转换器应用倍率（真实 300000 × 5），数量用全公司统计
    expect(payload.kpis.periodContractAmount).toBe("1500000.00");
    expect(payload.collection.totalContractAmount).toBe("5000000.00");
    expect(payload.collection.totalPaidAmount).toBe("2000000.00");
    expect(payload.kpis.totalCustomers).toBe(18);
    expect(payload.delivery.summary.shipmentCount).toBe(42);
    expect(payload.delivery.summary.unitCount).toBe(55);
    // 自由文本省份经校验：山东省 + 江苏省 有效，null/不存在省 被剔除
    expect(payload.delivery.summary.regionCount).toBe(2);

    // 公司目标取 salesUserId 为空的全公司行，个人目标被忽略
    expect(payload.collection.targetAmount).toBe("5000000.00");
    expect(payload.collection.actualAmount).toBe("1000000.00");

    // 路线样本：无法验证位置的行被剔除，已验证行只含白名单字段
    expect(payload.delivery.routes).toHaveLength(1);
    const route = payload.delivery.routes[0];
    expect(route.province).toBe("山东省");
    expect(route.city).toBe("济南市");
    expect(route.equipmentName).toBe("数控机床");
    expect(typeof route.key).toBe("string");
    expect("customer" in route).toBe(false);

    // 提醒样本带验证后的省份
    expect(payload.delivery.reminders.today).toHaveLength(1);
    expect(payload.delivery.reminders.today[0].province).toBe("山东省");
    expect(payload.delivery.reminders.today[0].city).toBe("青岛市");

    // 任意深度不得出现敏感键或倍率
    const forbidden = ["companyName", "customer", "customerName", "contactName", "phone", "email", "salesUser", "assignedUser", "followContent", "content", "receivingAddress", "fullAddress", "mapKey", "multipliers", "beforeData", "afterData"];
    const keys: string[] = [];
    (function collect(value: unknown) {
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.push(key);
          collect(child);
        }
      }
    })(payload);
    for (const key of keys) {
      expect(forbidden).not.toContain(key);
    }
  });

  it("queries CRM data only with the fixed company-wide current-month scope and no filters", async () => {
    mockSettingRows(activeShare, multiplierConfig);
    (getCrmDashboard as ReturnType<typeof vi.fn>).mockResolvedValue(mockDashboard());
    (listSalesTargets as ReturnType<typeof vi.fn>).mockResolvedValue({ period: { label: "2026年9月" }, targets: [] });
    mockBusinessQueries();

    await getPublicSalesScreenPayload(VALID_PUBLIC_ID, { now: fixedNow });

    // dashboard 读取：空参数（固定当月、无任何过滤器），服务器专用全公司身份
    expect(getCrmDashboard).toHaveBeenCalledTimes(1);
    const [user, searchParams, injectedNow] = (getCrmDashboard as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(user.role).toBe("SUPER_ADMIN");
    expect(user.viewScope).toBe("ALL");
    for (const filter of ["province", "region", "salesUserId", "customerStatus", "contractStatus", "shipmentStatus", "preset", "start", "end"]) {
      expect(searchParams.get(filter)).toBeNull();
    }
    // 同一时钟贯穿目标周期与 dashboard 统计，消除跨月零点的口径撕裂
    expect(injectedNow).toEqual(FIXED_NOW);
    // 目标读取：MONTH 周期（固定当月）+ 全公司合同额口径
    expect(listSalesTargets).toHaveBeenCalledWith(expect.objectContaining({ role: "SUPER_ADMIN" }), expect.objectContaining({ periodType: "MONTH", periodYear: 2026, periodIndex: 9 }), "CONTRACT_AMOUNT");
  });

  it("serves a safe zeroed payload when no company target exists", async () => {
    mockSettingRows(activeShare, { ...multiplierConfig, multipliers: { ...multiplierConfig.multipliers, amount: 1 } });
    (getCrmDashboard as ReturnType<typeof vi.fn>).mockResolvedValue(mockDashboard());
    (listSalesTargets as ReturnType<typeof vi.fn>).mockResolvedValue({ period: { label: "2026年9月" }, targets: [] });
    mockBusinessQueries();

    const payload = await getPublicSalesScreenPayload(VALID_PUBLIC_ID, { now: fixedNow });

    expect(payload.collection.targetAmount).toBe("0.00");
    expect(payload.collection.actualAmount).toBe("0.00");
    expect(payload.collection.targetRate).toBe(0);
    // 倍率 1 时金额保持真实口径
    expect(payload.kpis.periodContractAmount).toBe("300000.00");
  });
});
