import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessCustomer } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.customerId || !body.followType || !body.content) {
    return NextResponse.json(
      { error: "客户ID、跟进方式和跟进内容为必填项" },
      { status: 400 }
    );
  }

  // 验证客户存在且有权限
  const customer = await prisma.customer.findFirst({
    where: { id: body.customerId, deletedAt: null },
  });

  if (!customer) {
    return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  }

  if (!canAccessCustomer(user, customer)) {
    return NextResponse.json({ error: "无权限为该客户添加跟进记录" }, { status: 403 });
  }

  // 使用事务同时创建跟进记录并更新客户信息
  const result = await prisma.$transaction(async (tx) => {
    // 1. 创建跟进记录
    const followRecord = await tx.followRecord.create({
      data: {
        customerId: body.customerId,
        userId: user.id,
        followType: body.followType,
        content: body.content,
        result: body.result || null,
        address: body.address || null,
        nextFollowDate: body.nextFollowDate ? new Date(body.nextFollowDate) : null,
        newStatus: body.newStatus || null,
      },
    });

    // 2. 更新客户的 lastFollowDate 和 nextFollowDate
    const customerUpdate: any = {
      lastFollowDate: new Date(),
    };

    // 3. 如果设置了下次跟进日期，更新客户主表
    if (body.nextFollowDate) {
      customerUpdate.nextFollowDate = new Date(body.nextFollowDate);
    }

    // 4. 如果跟进记录中修改了客户状态，同步更新
    if (body.newStatus) {
      customerUpdate.status = body.newStatus;
    }

    await tx.customer.update({
      where: { id: body.customerId },
      data: customerUpdate,
    });

    return followRecord;
  });

  return NextResponse.json(result, { status: 201 });
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");

  if (!customerId) {
    return NextResponse.json({ error: "缺少客户ID" }, { status: 400 });
  }

  // 验证客户权限
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
  });

  if (!customer) {
    return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  }

  if (!canAccessCustomer(user, customer)) {
    return NextResponse.json({ error: "无权限查看该客户跟进记录" }, { status: 403 });
  }

  const records = await prisma.followRecord.findMany({
    where: { customerId },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(records);
}
