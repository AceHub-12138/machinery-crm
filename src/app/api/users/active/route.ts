import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin, canSeeAllData } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const excludeUserId = searchParams.get("excludeUserId") || "";

    const where: any = {
      isActive: true,
    };

    if (excludeUserId) {
      where.id = { not: excludeUserId };
    }

    if (!canSeeAllData(user)) {
      where.id = user.id;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        region: true,
        isActive: true,
      },
      orderBy: [
        { region: "asc" },
        { name: "asc" },
      ],
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error("[users.active.GET]", error);
    return NextResponse.json({ error: "启用账号列表加载失败" }, { status: 500 });
  }
}
