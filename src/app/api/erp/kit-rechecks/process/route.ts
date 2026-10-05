import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { processPendingKitRechecks } from "@/lib/kit-recheck";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  const cronAllowed = Boolean(process.env.ERP_CRON_SECRET && request.headers.get("x-cron-secret") === process.env.ERP_CRON_SECRET);
  if (!cronAllowed && (!user || !isSuperAdmin(user))) return NextResponse.json({ error: "未授权" }, { status: user ? 403 : 401 });

  let checkedById = "";
  if (cronAllowed) {
    const systemUserId = String(request.headers.get("x-system-user-id") || "");
    const systemUser = systemUserId ? await prisma.user.findFirst({ where: { id: systemUserId, role: "SUPER_ADMIN", isActive: true }, select: { id: true } }) : null;
    if (!systemUser) return NextResponse.json({ error: "定时任务需要有效的超级管理员 x-system-user-id" }, { status: 400 });
    checkedById = systemUser.id;
  } else {
    checkedById = user!.id;
  }

  const results = await prisma.$transaction((tx) => processPendingKitRechecks(tx, checkedById), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30000,
  });
  return NextResponse.json({ processed: results.length, results });
}
