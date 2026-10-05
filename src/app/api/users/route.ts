import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageUsers } from "@/lib/permissions";
import { sanitizeTerritories } from "@/lib/region-data";
import { writeOperationLog } from "@/lib/sales-items";
import { roleRequiresRegionScope } from "@/lib/erp-roles";

const VALID_ROLES = ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"] as const;

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

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!canManageUsers(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "1";
    const activeOnly = searchParams.get("activeOnly") === "1";
    const where = includeInactive && !activeOnly ? undefined : { isActive: true };

    const users = await prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error("[users.GET]", error);
    return NextResponse.json({ error: "用户列表加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!canManageUsers(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json();
    if (!body.email || !body.password || !body.name || !body.role) {
      return NextResponse.json({ error: "姓名、账号、密码和角色为必填项" }, { status: 400 });
    }
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "角色无效" }, { status: 400 });
    }

    const account = String(body.email).trim();
    const name = String(body.name).trim();
    if (!account) return NextResponse.json({ error: "账号不能为空" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
    if (String(body.password).length < 8) {
      return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email: account } });
    if (existing) {
      return NextResponse.json({ error: "该账号已存在，请更换账号" }, { status: 409 });
    }

    const territories = roleRequiresRegionScope(body.role) ? sanitizeTerritories(body.territories) : [];
    if (roleRequiresRegionScope(body.role) && territories.length === 0) {
      return NextResponse.json({ error: "销售和外贸销售必须选择负责范围" }, { status: 400 });
    }
    const hashedPassword = await bcryptjs.hash(body.password, 12);

    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: account,
          password: hashedPassword,
          name,
          role: body.role,
          region: roleRequiresRegionScope(body.role) ? body.region || "其他" : "其他",
          territories,
          viewScope: body.role === "SUPER_ADMIN" ? "ALL" : "TERRITORY",
          isActive: true,
        },
        select: USER_SELECT,
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: "CREATE_USER",
        entityType: "User",
        entityId: created.id,
        afterData: created,
      });

      return created;
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("[users.POST]", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "该账号已存在，请更换账号" }, { status: 409 });
    }
    return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
  }
}
