import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { assertAfterSalesAccess } from "@/lib/after-sales-service";
import { isPrismaUniqueError } from "@/lib/after-sales";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    return NextResponse.json({ items: await prisma.afterSalesSupplementPart.findMany({ orderBy: { name: "asc" } }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "补充配件加载失败" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const name = String((await request.json()).name || "").trim();
    if (!name) throw new Error("配件名称必填");
    if (name.length > 191) throw new Error("配件名称不能超过 191 个字符");
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.afterSalesSupplementPart.create({ data: { name, createdById: user.id } });
      await writeOperationLog(tx, { userId: user.id, action: "CREATE_AFTER_SALES_SUPPLEMENT_PART", entityType: "AfterSalesSupplementPart", entityId: created.id, afterData: created });
      return created;
    });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    const duplicate = isPrismaUniqueError(error);
    return NextResponse.json({ error: duplicate ? "该补充配件已存在" : error instanceof Error ? error.message : "新增补充配件失败" }, { status: duplicate ? 409 : 400 });
  }
}
