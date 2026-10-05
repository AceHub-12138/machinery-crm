import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/permissions";
import { SALES_SCREEN_SETTING_KEY } from "@/modules/screen/config";

// Mock Prisma at top level before any imports that depend on it
vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
    operationLog: {
      create: vi.fn(),
    },
  },
}));

// Import after mock is set up
const { listSettings, saveSetting, SETTINGS_ALLOWLIST } = await import("./service");
const { prisma } = await import("@/lib/db");

describe("system settings service", () => {
  const superAdmin: SessionUser = {
    id: "admin-1",
    role: "SUPER_ADMIN",
    region: "",
    viewScope: "ALL",
    territories: [],
  };

  const salesUser: SessionUser = {
    id: "sales-1",
    role: "SALES",
    region: "山东",
    viewScope: "TERRITORY",
    territories: [{ province: "山东", cities: [] }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes salesScreen in allowlist", () => {
    expect(SETTINGS_ALLOWLIST).toContain(SALES_SCREEN_SETTING_KEY);
  });

  it("allows super admin to list settings", async () => {
    (prisma.systemSetting.findMany as any).mockResolvedValue([
      { key: SALES_SCREEN_SETTING_KEY, value: { version: 1, enabled: false }, updatedAt: new Date() },
    ]);

    const result = await listSettings(superAdmin);
    expect(result.items).toBeDefined();
    expect(prisma.systemSetting.findMany).toHaveBeenCalledWith({
      where: { key: { in: expect.arrayContaining([SALES_SCREEN_SETTING_KEY]) } },
      orderBy: { key: "asc" },
    });
  });

  it("normalizes salesScreen config when listing settings", async () => {
    const corruptedConfig = {
      version: 1,
      enabled: false,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      multipliers: { amount: 0, customerCount: 150, contractCount: 5.5, shipmentCount: -1 }, // 全部非法
      privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: true },
    };

    (prisma.systemSetting.findMany as any).mockResolvedValue([
      { key: SALES_SCREEN_SETTING_KEY, value: corruptedConfig, updatedAt: new Date() },
    ]);

    const result = await listSettings(superAdmin);
    const salesScreenItem = result.items.find((item: any) => item.key === SALES_SCREEN_SETTING_KEY);

    // 归一化后所有非法倍率都应该回退到 1
    expect(salesScreenItem).toBeDefined();
    expect((salesScreenItem!.value as any).multipliers.amount).toBe(1);
    expect((salesScreenItem!.value as any).multipliers.customerCount).toBe(1);
    expect((salesScreenItem!.value as any).multipliers.contractCount).toBe(1);
    expect((salesScreenItem!.value as any).multipliers.shipmentCount).toBe(1);
  });

  it("rejects non-admin from listing settings", async () => {
    await expect(listSettings(salesUser)).rejects.toThrow("无权限访问配置中心");
    expect(prisma.systemSetting.findMany).not.toHaveBeenCalled();
  });

  it("allows super admin to save valid salesScreen config", async () => {
    const validConfig = {
      version: 1,
      enabled: true,
      modules: {
        operatingKpis: true,
        deliveryMap: true,
        collection: true,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: {
        amount: 5,
        customerCount: 2,
        contractCount: 3,
        shipmentCount: 10,
      },
      privacy: {
        contractNumberMode: "masked",
        addressLevel: "province",
        showDisplayNotice: false,
      },
    };

    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        systemSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ key: SALES_SCREEN_SETTING_KEY, value: validConfig }),
        },
        operationLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    });

    const result = await saveSetting(superAdmin, SALES_SCREEN_SETTING_KEY, validConfig);
    expect(result.key).toBe(SALES_SCREEN_SETTING_KEY);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("rejects invalid salesScreen config before database upsert", async () => {
    const invalidConfig = {
      version: 1,
      enabled: false,
      modules: {
        operatingKpis: false,
        deliveryMap: false,
        collection: false,
        deliveryAlerts: false,
        deliveryMilestones: false, // 所有板块关闭
      },
      multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 },
      privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: true },
    };

    await expect(saveSetting(superAdmin, SALES_SCREEN_SETTING_KEY, invalidConfig)).rejects.toThrow("至少需要启用一个板块");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects salesScreen config with unknown fields", async () => {
    const configWithUnknown = {
      version: 1,
      enabled: false,
      modules: {
        operatingKpis: true,
        deliveryMap: true,
        collection: true,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 },
      privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: true },
      hackerField: "should be rejected",
    };

    await expect(saveSetting(superAdmin, SALES_SCREEN_SETTING_KEY, configWithUnknown)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects non-admin from saving salesScreen config", async () => {
    const validConfig = {
      version: 1,
      enabled: false,
      modules: {
        operatingKpis: true,
        deliveryMap: true,
        collection: true,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 },
      privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: true },
    };

    await expect(saveSetting(salesUser, SALES_SCREEN_SETTING_KEY, validConfig)).rejects.toThrow("无权限访问配置中心");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes operation log when saving salesScreen config", async () => {
    const validConfig = {
      version: 1,
      enabled: false,
      modules: {
        operatingKpis: true,
        deliveryMap: true,
        collection: true,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 },
      privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: true },
    };

    const mockOperationLogCreate = vi.fn().mockResolvedValue({});
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        systemSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ key: SALES_SCREEN_SETTING_KEY, value: validConfig }),
        },
        operationLog: {
          create: mockOperationLogCreate,
        },
      };
      return callback(tx);
    });

    await saveSetting(superAdmin, SALES_SCREEN_SETTING_KEY, validConfig);
    expect(mockOperationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: superAdmin.id,
        action: "UPDATE_SYSTEM_SETTING",
        entityType: "SystemSetting",
        entityId: SALES_SCREEN_SETTING_KEY,
      }),
    });
  });

  it("does not break existing reminders and printInfo settings", async () => {
    const reminderConfig = { enabled: true };

    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        systemSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ key: "reminders", value: reminderConfig }),
        },
        operationLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    });

    const result = await saveSetting(superAdmin, "reminders", reminderConfig);
    expect(result.key).toBe("reminders");
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
