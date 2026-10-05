import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/permissions";

vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const { readSalesScreenShare } = await import("./share-service");
const { SALES_SCREEN_SHARE_SETTING_KEY } = await import("./share");
const { SETTINGS_ALLOWLIST } = await import("@/modules/system/settings/service");
const { SALES_SCREEN_SETTING_KEY } = await import("@/modules/screen/config");
const { prisma } = await import("@/lib/db");

const superAdmin: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "",
  viewScope: "ALL",
  territories: [],
};

const FIXED_NOW = new Date("2026-09-21T08:00:00.000Z");
const fixedNow = () => FIXED_NOW;

// 在 $transaction mock 内构造带 Spy 的 tx，并暴露给断言
let txSpy: {
  systemSettingFindUnique: ReturnType<typeof vi.fn>;
  systemSettingUpsert: ReturnType<typeof vi.fn>;
  operationLogCreate: ReturnType<typeof vi.fn>;
};

function mockTransaction(beforeValue: unknown, upsertResult: unknown = { key: SALES_SCREEN_SHARE_SETTING_KEY }) {
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    txSpy = {
      systemSettingFindUnique: vi.fn().mockResolvedValue(
        beforeValue === undefined ? null : { key: SALES_SCREEN_SHARE_SETTING_KEY, value: beforeValue }
      ),
      systemSettingUpsert: vi.fn().mockResolvedValue(upsertResult),
      operationLogCreate: vi.fn().mockResolvedValue({}),
    };
    const tx = {
      systemSetting: {
        findUnique: txSpy.systemSettingFindUnique,
        upsert: txSpy.systemSettingUpsert,
      },
      operationLog: { create: txSpy.operationLogCreate },
    };
    return callback(tx);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sales screen share settings isolation", () => {
  it("keeps salesScreenShare out of the generic settings allowlist so PUT cannot write it", () => {
    expect(SETTINGS_ALLOWLIST).not.toContain(SALES_SCREEN_SHARE_SETTING_KEY);
    expect(SETTINGS_ALLOWLIST).toContain(SALES_SCREEN_SETTING_KEY);
  });
});

describe("readSalesScreenShare", () => {
  it("returns the safe disabled view when no share setting exists yet", async () => {
    (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const view = await readSalesScreenShare(superAdmin);

    expect(view).toEqual({
      share: { version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: null },
      path: null,
    });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: SALES_SCREEN_SHARE_SETTING_KEY } });
  });

  it("normalizes corrupt stored values into the safe disabled view", async () => {
    (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: SALES_SCREEN_SHARE_SETTING_KEY,
      value: { version: 1, publicId: "corrupt-short", createdAt: "nonsense", rotatedAt: null, revokedAt: null },
    });

    const view = await readSalesScreenShare(superAdmin);
    expect(view.share.publicId).toBeNull();
    expect(view.path).toBeNull();
  });
});

describe("createOrRotateSalesScreenShare (first generation)", () => {
  it("stores a valid publicId with createdAt semantics and writes a link-free operation log", async () => {
    mockTransaction(null);
    const { createOrRotateSalesScreenShare } = await import("./share-service");

    const view = await createOrRotateSalesScreenShare(superAdmin, { now: fixedNow });

    // 返回视图：新 publicId + 相对路径
    expect(view.share.version).toBe(1);
    expect(view.share.publicId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(view.share.createdAt).toBe("2026-09-21T08:00:00.000Z");
    expect(view.share.rotatedAt).toBeNull();
    expect(view.share.revokedAt).toBeNull();
    expect(view.path).toBe(`/screen/sales/${view.share.publicId}?kiosk=1`);

    // 写入设置值包含 publicId 原值（第一版约定，供超管复制）
    expect(txSpy.systemSettingUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = txSpy.systemSettingUpsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ key: SALES_SCREEN_SHARE_SETTING_KEY });
    expect(upsertArg.create.value).toEqual(view.share);
    expect(upsertArg.update.value).toEqual(view.share);

    // 操作日志只记录元数据
    expect(txSpy.operationLogCreate).toHaveBeenCalledTimes(1);
    expect(txSpy.operationLogCreate.mock.calls[0][0]).toEqual({
      data: {
        userId: superAdmin.id,
        action: "CREATE_SALES_SCREEN_SHARE",
        entityType: "SystemSetting",
        entityId: SALES_SCREEN_SHARE_SETTING_KEY,
        beforeData: { hadLink: false },
        afterData: { hadLink: true },
      },
    });
  });
});

describe("createOrRotateSalesScreenShare (rotation)", () => {
  it("replaces the old publicId with a different new one on the second generation", async () => {
    mockTransaction(null);
    const { createOrRotateSalesScreenShare } = await import("./share-service");

    const first = await createOrRotateSalesScreenShare(superAdmin, { now: fixedNow });
    const oldPublicId = first.share.publicId;

    const storedAfterFirst = first.share;
    mockTransaction(storedAfterFirst);

    const second = await createOrRotateSalesScreenShare(superAdmin, { now: fixedNow });

    expect(second.share.publicId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.share.publicId).not.toBe(oldPublicId);
    // 第二次写入的是新状态，旧 publicId 被替换
    const secondUpsertValue = txSpy.systemSettingUpsert.mock.calls[0][0].create.value;
    expect(secondUpsertValue.publicId).toBe(second.share.publicId);
    expect(secondUpsertValue.publicId).not.toBe(oldPublicId);
  });

  it("keeps createdAt, stamps rotatedAt, clears any stale revocation marker and logs ROTATE", async () => {
    const oldState = {
      version: 1 as const,
      publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ",
      createdAt: "2026-09-01T00:00:00.000Z",
      rotatedAt: null,
      revokedAt: null,
    };
    mockTransaction(oldState);
    const { createOrRotateSalesScreenShare } = await import("./share-service");

    const view = await createOrRotateSalesScreenShare(superAdmin, { now: fixedNow });

    expect(view.share.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(view.share.rotatedAt).toBe("2026-09-21T08:00:00.000Z");
    expect(view.share.revokedAt).toBeNull();

    expect(txSpy.operationLogCreate.mock.calls[0][0]).toEqual({
      data: {
        userId: superAdmin.id,
        action: "ROTATE_SALES_SCREEN_SHARE",
        entityType: "SystemSetting",
        entityId: SALES_SCREEN_SHARE_SETTING_KEY,
        beforeData: { hadLink: true },
        afterData: { hadLink: true },
      },
    });
  });
});

describe("revokeSalesScreenShare", () => {
  it("clears publicId, stamps revokedAt, keeps history and writes a link-free log", async () => {
    const activeState = {
      version: 1 as const,
      publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ",
      createdAt: "2026-09-01T00:00:00.000Z",
      rotatedAt: "2026-09-10T00:00:00.000Z",
      revokedAt: null,
    };
    mockTransaction(activeState);
    const { revokeSalesScreenShare } = await import("./share-service");

    const view = await revokeSalesScreenShare(superAdmin, { now: fixedNow });

    expect(view.share).toEqual({
      version: 1,
      publicId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      rotatedAt: "2026-09-10T00:00:00.000Z",
      revokedAt: "2026-09-21T08:00:00.000Z",
    });
    expect(view.path).toBeNull();

    const upsertValue = txSpy.systemSettingUpsert.mock.calls[0][0].create.value;
    expect(upsertValue).toEqual(view.share);

    expect(txSpy.operationLogCreate.mock.calls[0][0]).toEqual({
      data: {
        userId: superAdmin.id,
        action: "REVOKE_SALES_SCREEN_SHARE",
        entityType: "SystemSetting",
        entityId: SALES_SCREEN_SHARE_SETTING_KEY,
        beforeData: { hadLink: true },
        afterData: { hadLink: false },
      },
    });
  });

  it("does not write settings or logs when there is no active link to revoke", async () => {
    mockTransaction({ version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: "2026-09-20T00:00:00.000Z" });
    const { revokeSalesScreenShare } = await import("./share-service");

    const view = await revokeSalesScreenShare(superAdmin, { now: fixedNow });

    expect(view.share.publicId).toBeNull();
    expect(txSpy.systemSettingUpsert).not.toHaveBeenCalled();
    expect(txSpy.operationLogCreate).not.toHaveBeenCalled();
  });
});

describe("share service permission boundary", () => {
  const salesUser: SessionUser = {
    id: "sales-1",
    role: "SALES",
    region: "山东",
    viewScope: "TERRITORY",
    territories: [{ province: "山东", cities: [] }],
  };
  const tradeUser: SessionUser = { ...salesUser, id: "trade-1", role: "FOREIGN_TRADE" };

  it("rejects read, generate and revoke for non SUPER_ADMIN with a Chinese 403 before any Prisma access", async () => {
    (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.systemSetting.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { createOrRotateSalesScreenShare, revokeSalesScreenShare } = await import("./share-service");

    for (const user of [salesUser, tradeUser]) {
      await expect(readSalesScreenShare(user)).rejects.toMatchObject({
        message: "无权限管理展厅大屏共享链接",
        status: 403,
      });
      await expect(createOrRotateSalesScreenShare(user)).rejects.toMatchObject({ status: 403 });
      await expect(revokeSalesScreenShare(user)).rejects.toMatchObject({ status: 403 });
    }

    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("share service persistence invariants", () => {
  it("updates settings and writes the operation log through the same transaction client", async () => {
    mockTransaction(null);
    const { createOrRotateSalesScreenShare } = await import("./share-service");

    await createOrRotateSalesScreenShare(superAdmin, { now: fixedNow });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // findUnique、upsert 与日志写入使用同一个 tx
    expect(txSpy.systemSettingFindUnique).toHaveBeenCalledTimes(1);
    expect(txSpy.systemSettingUpsert).toHaveBeenCalledTimes(1);
    expect(txSpy.operationLogCreate).toHaveBeenCalledTimes(1);
  });

  it("serializes every operation log argument without ever exposing old or new publicId", async () => {
    const oldState = {
      version: 1 as const,
      publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ",
      createdAt: "2026-09-01T00:00:00.000Z",
      rotatedAt: null,
      revokedAt: null,
    };
    mockTransaction(oldState);
    const { createOrRotateSalesScreenShare, revokeSalesScreenShare } = await import("./share-service");

    const rotated = await createOrRotateSalesScreenShare(superAdmin, { now: fixedNow });

    let serialized = JSON.stringify(txSpy.operationLogCreate.mock.calls);
    expect(serialized).not.toContain(oldState.publicId);
    expect(serialized).not.toContain(rotated.share.publicId);
    // 日志确实记录了操作类型与 hadLink 元数据
    expect(serialized).toContain("ROTATE_SALES_SCREEN_SHARE");
    expect(serialized).toContain('"hadLink":true');

    const revokingState = rotated.share;
    mockTransaction(revokingState);
    await revokeSalesScreenShare(superAdmin, { now: fixedNow });

    serialized = JSON.stringify(txSpy.operationLogCreate.mock.calls);
    expect(serialized).not.toContain(revokingState.publicId);
    expect(serialized).toContain("REVOKE_SALES_SCREEN_SHARE");
  });
});
