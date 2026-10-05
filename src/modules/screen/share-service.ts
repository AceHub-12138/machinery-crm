import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";
import { writeOperationLog } from "@/lib/sales-items";
import {
  buildSalesScreenShareView,
  generatePublicId,
  normalizeSalesScreenShareState,
  parseSalesScreenShareState,
  SALES_SCREEN_SHARE_SETTING_KEY,
  type SalesScreenShareState,
  type SalesScreenShareView,
} from "./share";

function assertShareAdmin(user: SessionUser) {
  if (user.role !== "SUPER_ADMIN") throw new DomainError("无权限管理展厅大屏共享链接", 403);
}

export async function readSalesScreenShare(user: SessionUser): Promise<SalesScreenShareView> {
  assertShareAdmin(user);
  const row = await prisma.systemSetting.findUnique({ where: { key: SALES_SCREEN_SHARE_SETTING_KEY } });
  return buildSalesScreenShareView(normalizeSalesScreenShareState(row?.value));
}

function upsertShareState(
  tx: Parameters<typeof writeOperationLog>[0],
  state: SalesScreenShareState,
  userId: string
) {
  return tx.systemSetting.upsert({
    where: { key: SALES_SCREEN_SHARE_SETTING_KEY },
    create: { key: SALES_SCREEN_SHARE_SETTING_KEY, value: state, updatedById: userId },
    update: { value: state, updatedById: userId },
  });
}

export type ShareMutationOptions = {
  now?: () => Date;
};

export async function createOrRotateSalesScreenShare(
  user: SessionUser,
  options: ShareMutationOptions = {}
): Promise<SalesScreenShareView> {
  assertShareAdmin(user);
  const now = options.now ?? (() => new Date());

  return prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key: SALES_SCREEN_SHARE_SETTING_KEY } });
    const current = normalizeSalesScreenShareState(before?.value);
    const hadLink = current.publicId !== null;
    const timestamp = now().toISOString();

    const next: SalesScreenShareState = {
      version: 1,
      publicId: generatePublicId(),
      // 首次生成写入 createdAt；轮换保留 createdAt 并写入 rotatedAt
      createdAt: hadLink ? current.createdAt : timestamp,
      rotatedAt: hadLink ? timestamp : null,
      // 生成有效链接时清理冲突的撤销标记
      revokedAt: null,
    };
    // 持久化前按契约自检
    parseSalesScreenShareState(next);

    await upsertShareState(tx, next, user.id);
    await writeOperationLog(tx, {
      userId: user.id,
      action: hadLink ? "ROTATE_SALES_SCREEN_SHARE" : "CREATE_SALES_SCREEN_SHARE",
      entityType: "SystemSetting",
      entityId: SALES_SCREEN_SHARE_SETTING_KEY,
      beforeData: { hadLink },
      afterData: { hadLink: true },
    });

    return buildSalesScreenShareView(next);
  });
}

export async function revokeSalesScreenShare(
  user: SessionUser,
  options: ShareMutationOptions = {}
): Promise<SalesScreenShareView> {
  assertShareAdmin(user);
  const now = options.now ?? (() => new Date());

  return prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key: SALES_SCREEN_SHARE_SETTING_KEY } });
    const current = normalizeSalesScreenShareState(before?.value);
    const hadLink = current.publicId !== null;

    // 没有有效链接可撤销：保持幂等，不重复写设置与日志
    if (!hadLink) return buildSalesScreenShareView(current);

    const next: SalesScreenShareState = {
      version: 1,
      publicId: null,
      createdAt: current.createdAt,
      rotatedAt: current.rotatedAt,
      revokedAt: now().toISOString(),
    };
    parseSalesScreenShareState(next);

    await upsertShareState(tx, next, user.id);
    await writeOperationLog(tx, {
      userId: user.id,
      action: "REVOKE_SALES_SCREEN_SHARE",
      entityType: "SystemSetting",
      entityId: SALES_SCREEN_SHARE_SETTING_KEY,
      beforeData: { hadLink: true },
      afterData: { hadLink: false },
    });

    return buildSalesScreenShareView(next);
  });
}
