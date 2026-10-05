import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageUsers } from "@/lib/permissions";
import { sanitizeTerritories } from "@/lib/region-data";
import { writeOperationLog } from "@/lib/sales-items";
import { roleRequiresRegionScope } from "@/lib/erp-roles";

const VALID_ROLES = ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"];
const VALID_REGIONS = ["华北", "华南", "华东", "外贸", "其他"];

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  region: true,
  territories: true,
  viewScope: true,
  isActive: true,
  createdAt: true,
};

async function getRelatedCounts(userId: string) {
  const [
    customers,
    salesContracts,
    createdContracts,
    quotes,
    shipments,
    follows,
    payments,
  ] = await Promise.all([
    prisma.customer.count({ where: { assignedUserId: userId } }),
    prisma.contract.count({ where: { salesUserId: userId } }),
    prisma.contract.count({ where: { createdById: userId } }),
    prisma.customerQuote.count({ where: { createdById: userId } }),
    prisma.shipment.count({ where: { createdById: userId } }),
    prisma.followRecord.count({ where: { userId } }),
    prisma.contractPayment.count({ where: { createdById: userId } }),
  ]);

  return {
    customers,
    salesContracts,
    createdContracts,
    quotes,
    shipments,
    follows,
    payments,
    total: customers + salesContracts + createdContracts + quotes + shipments + follows + payments,
  };
}

async function ensureCanDisableSuperAdmin(targetUser: { role: string; isActive: boolean }) {
  if (targetUser.role !== "SUPER_ADMIN" || !targetUser.isActive) return null;
  const activeSuperAdminCount = await prisma.user.count({
    where: { role: "SUPER_ADMIN", isActive: true },
  });
  if (activeSuperAdminCount <= 1) {
    return "至少需要保留一个启用状态的超级管理员";
  }
  return null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!canManageUsers(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const body = await request.json();

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!targetUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

    const willLoseActiveSuperAdmin =
      targetUser.role === "SUPER_ADMIN" &&
      (body.isActive === false || (body.role !== undefined && body.role !== "SUPER_ADMIN"));

    if (willLoseActiveSuperAdmin) {
      const error = await ensureCanDisableSuperAdmin(targetUser);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const updateData: any = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
      updateData.name = name;
    }

    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role)) return NextResponse.json({ error: "角色无效" }, { status: 400 });
      updateData.role = body.role;
    }

    const nextRole = String(body.role || targetUser.role);
    const existingTerritories = sanitizeTerritories(targetUser.territories);
    const submittedTerritories = body.territories === undefined ? existingTerritories : sanitizeTerritories(body.territories);
    const roleChanged = body.role !== undefined && body.role !== targetUser.role;
    const territoriesChanged = JSON.stringify(submittedTerritories) !== JSON.stringify(existingTerritories);
    const regionChanged = body.region !== undefined && String(body.region) !== targetUser.region;
    const viewScopeChanged = body.viewScope !== undefined && String(body.viewScope) !== targetUser.viewScope;
    const scopeWasSubmitted = roleChanged || territoriesChanged || regionChanged || viewScopeChanged;
    if (scopeWasSubmitted) {
      if (roleRequiresRegionScope(nextRole)) {
        const territories = submittedTerritories;
        if (territories.length === 0) return NextResponse.json({ error: "销售和外贸销售必须选择负责范围" }, { status: 400 });
        updateData.region = body.region === undefined ? targetUser.region : String(body.region);
        updateData.territories = territories;
        updateData.viewScope = "TERRITORY";
      } else {
        updateData.region = "其他";
        updateData.territories = [];
        updateData.viewScope = nextRole === "SUPER_ADMIN" ? "ALL" : "TERRITORY";
      }
    }

    if (body.isActive !== undefined) {
      updateData.isActive = Boolean(body.isActive);
    }

    if (body.password) {
      if (String(body.password).length < 8) {
        return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
      }
      updateData.password = await bcryptjs.hash(body.password, 12);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "没有可更新的内容" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const after = await tx.user.update({
        where: { id },
        data: updateData,
        select: USER_SELECT,
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_USER",
        entityType: "User",
        entityId: id,
        beforeData: targetUser,
        afterData: after,
      });

      return after;
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[users.id.PUT]", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "账号或唯一字段重复，请检查后重试" }, { status: 409 });
    }
    return NextResponse.json({ error: "保存用户失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!canManageUsers(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    if (id === user.id) {
      return NextResponse.json({ error: "不能删除或禁用当前登录账号" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const transferToUserId = body?.transferToUserId ? String(body.transferToUserId) : "";

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!targetUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

    const superAdminError = await ensureCanDisableSuperAdmin(targetUser);
    if (superAdminError) return NextResponse.json({ error: superAdminError }, { status: 400 });

    const counts = await getRelatedCounts(id);
    if (counts.total > 0 && !transferToUserId) {
      return NextResponse.json({
        error: "该账号名下已有客户、合同、发货或跟进记录。删除该账号前，请选择一个接收账号，系统会将该账号名下数据转移到接收账号。",
        requiresTransfer: true,
        counts,
      }, { status: 409 });
    }

    let receiver = null;
    if (transferToUserId) {
      if (transferToUserId === id) {
        return NextResponse.json({ error: "接收账号不能选择当前要删除的账号" }, { status: 400 });
      }
      receiver = await prisma.user.findFirst({
        where: { id: transferToUserId, isActive: true },
        select: { id: true, email: true, name: true, role: true, region: true },
      });
      if (!receiver) {
        return NextResponse.json({ error: "接收账号不存在或已禁用" }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const transferResults: Record<string, number> = {};

      if (receiver) {
        transferResults.customers = (await tx.customer.updateMany({
          where: { assignedUserId: id },
          data: { assignedUserId: receiver.id },
        })).count;
        transferResults.salesContracts = (await tx.contract.updateMany({
          where: { salesUserId: id },
          data: { salesUserId: receiver.id },
        })).count;
        transferResults.createdContracts = (await tx.contract.updateMany({
          where: { createdById: id },
          data: { createdById: receiver.id },
        })).count;
        transferResults.quotes = (await tx.customerQuote.updateMany({
          where: { createdById: id },
          data: { createdById: receiver.id },
        })).count;
        transferResults.shipments = (await tx.shipment.updateMany({
          where: { createdById: id },
          data: { createdById: receiver.id },
        })).count;
        transferResults.follows = (await tx.followRecord.updateMany({
          where: { userId: id },
          data: { userId: receiver.id },
        })).count;
        transferResults.payments = (await tx.contractPayment.updateMany({
          where: { createdById: id },
          data: { createdById: receiver.id },
        })).count;
      }

      const disabled = await tx.user.update({
        where: { id },
        data: { isActive: false },
        select: USER_SELECT,
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: receiver ? "TRANSFER_AND_DISABLE_USER" : "DISABLE_USER",
        entityType: "User",
        entityId: id,
        beforeData: { user: targetUser, counts },
        afterData: { user: disabled, receiver, transferResults },
      });

      return { user: disabled, receiver, transferResults };
    });

    return NextResponse.json({
      success: true,
      message: result.receiver ? "账号数据已转移，原账号已禁用" : "账号已禁用",
      ...result,
    });
  } catch (error) {
    console.error("[users.id.DELETE]", error);
    return NextResponse.json({ error: "账号删除/转移失败" }, { status: 500 });
  }
}
