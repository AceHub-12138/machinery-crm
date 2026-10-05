import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canAccessERP(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const categories = await prisma.materialCategory.findMany({
    include: {
      children: {
        include: {
          children: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(categories);
}
