import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessCustomer, isSuperAdmin, canSeeAllData, matchesTerritory } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

async function getBusinessCounts(customerId: string) {
  const [contracts, quotes, follows, shipments, payments] = await Promise.all([
    prisma.contract.count({ where: { customerId, deletedAt: null } }),
    prisma.customerQuote.count({ where: { customerId } }),
    prisma.followRecord.count({ where: { customerId } }),
    prisma.shipment.count({ where: { contract: { customerId, deletedAt: null } } }),
    prisma.contractPayment.count({ where: { contract: { customerId, deletedAt: null } } }),
  ]);
  return {
    contracts,
    quotes,
    follows,
    shipments,
    payments,
    total: contracts + quotes + follows + shipments + payments,
  };
}

async function ensureActiveAssignee(assignedUserId: string | null | undefined) {
  if (!assignedUserId) return null;
  const assignee = await prisma.user.findFirst({
    where: { id: assignedUserId, isActive: true },
    select: { id: true },
  });
  if (!assignee) throw new Error("归属业务员不存在或已禁用");
  return assignee.id;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await params;
    const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "1";

    const customer = await prisma.customer.findFirst({
      where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
      include: {
        assignedUser: { select: { id: true, name: true, email: true, isActive: true } },
        followRecords: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: { contracts: true, customerQuotes: true, followRecords: true },
        },
      },
    });

    if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (!canAccessCustomer(user, customer)) {
      return NextResponse.json({ error: "无权访问该客户" }, { status: 403 });
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error("[customers.id.GET]", error);
    return NextResponse.json({ error: "客户详情加载失败" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (!canAccessCustomer(user, existing)) {
      return NextResponse.json({ error: "无权编辑该客户" }, { status: 403 });
    }

    const body = await request.json();
    const assignedUserId = body.assignedUserId !== undefined
      ? await ensureActiveAssignee(body.assignedUserId || null)
      : existing.assignedUserId;

    // 非全局用户:编辑后客户仍须落在自己负责的省/市内
    if (!canSeeAllData(user)) {
      const finalProvince = body.province !== undefined ? cleanText(body.province) : existing.province;
      const finalCity = body.city !== undefined ? cleanText(body.city) : existing.city;
      if (!matchesTerritory(user.territories, finalProvince, finalCity)) {
        return NextResponse.json({ error: "只能把客户保存在自己负责的省/市范围内" }, { status: 403 });
      }
    }

    const updateData: any = {};
    if (body.companyName !== undefined) updateData.companyName = String(body.companyName).trim();
    if (body.contactName !== undefined) updateData.contactName = String(body.contactName).trim();
    if (body.phone !== undefined) updateData.phone = cleanText(body.phone);
    if (body.wechat !== undefined) updateData.wechat = cleanText(body.wechat);
    if (body.whatsapp !== undefined) updateData.whatsapp = cleanText(body.whatsapp);
    if (body.email !== undefined) updateData.email = cleanText(body.email);
    if (body.country !== undefined) updateData.country = cleanText(body.country) || "中国";
    if (body.province !== undefined) updateData.province = cleanText(body.province);
    if (body.city !== undefined) updateData.city = cleanText(body.city);
    if (isSuperAdmin(user) && body.region !== undefined) updateData.region = String(body.region).trim();
    if (canSeeAllData(user) && body.businessLine !== undefined) updateData.businessLine = body.businessLine === "外贸" ? "外贸" : "国内销售";
    if (body.address !== undefined) updateData.address = cleanText(body.address);
    if (body.customerSource !== undefined) updateData.customerSource = body.customerSource;
    if (body.customerType !== undefined) updateData.customerType = body.customerType;
    if (body.customerLevel !== undefined) updateData.customerLevel = body.customerLevel;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.interestTags !== undefined) updateData.interestTags = body.interestTags || [];
    if (body.assignedUserId !== undefined) updateData.assignedUserId = assignedUserId;
    if (body.remark !== undefined) updateData.remark = cleanText(body.remark);
    if (body.nextFollowDate !== undefined) updateData.nextFollowDate = body.nextFollowDate ? new Date(body.nextFollowDate) : null;

    if (updateData.companyName === "") return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
    if (updateData.contactName === "") return NextResponse.json({ error: "联系人不能为空" }, { status: 400 });

    const duplicateConditions: any[] = [];
    if (updateData.companyName) duplicateConditions.push({ companyName: updateData.companyName, deletedAt: null, id: { not: id } });
    if (updateData.phone) duplicateConditions.push({ phone: updateData.phone, deletedAt: null, id: { not: id } });
    if (updateData.email) duplicateConditions.push({ email: updateData.email, deletedAt: null, id: { not: id } });
    if (updateData.whatsapp) duplicateConditions.push({ whatsapp: updateData.whatsapp, deletedAt: null, id: { not: id } });
    if (duplicateConditions.length > 0) {
      const duplicate = await prisma.customer.findFirst({
        where: { OR: duplicateConditions },
        select: { companyName: true, contactName: true },
      });
      if (duplicate) {
        return NextResponse.json({ error: `客户信息可能重复：${duplicate.companyName}（${duplicate.contactName}）` }, { status: 409 });
      }
    }

    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: updateData,
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_CUSTOMER",
        entityType: "Customer",
        entityId: id,
        beforeData: existing,
        afterData: updated,
      });

      return updated;
    });

    return NextResponse.json(customer);
  } catch (error: any) {
    console.error("[customers.id.PUT]", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "客户唯一字段重复，请检查公司名称、电话、邮箱或 WhatsApp" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || "保存客户失败" }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "客户不存在或已删除" }, { status: 404 });
    if (!canAccessCustomer(user, existing)) {
      return NextResponse.json({ error: "无权删除该客户" }, { status: 403 });
    }
    if (!isSuperAdmin(user) && existing.assignedUserId !== user.id) {
      return NextResponse.json({ error: "普通销售不能删除其他业务员名下客户" }, { status: 403 });
    }

    const counts = await getBusinessCounts(id);
    const deleted = await prisma.$transaction(async (tx) => {
      const after = await tx.customer.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: "DELETE_CUSTOMER",
        entityType: "Customer",
        entityId: id,
        beforeData: { customer: existing, counts },
        afterData: after,
      });

      return after;
    });

    return NextResponse.json({
      success: true,
      message: counts.total > 0
        ? "客户已从客户列表隐藏，历史业务记录仍会保留"
        : "客户已删除",
      counts,
      customer: deleted,
    });
  } catch (error) {
    console.error("[customers.id.DELETE]", error);
    return NextResponse.json({ error: "删除客户失败" }, { status: 500 });
  }
}
