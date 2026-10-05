import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

export const dynamic = "force-dynamic";

const ACCOUNT_SELECT = {
  id: true,
  username: true,
  displayName: true,
  remark: true,
  dailyQuota: true,
  isActive: true,
  createdAt: true,
};

/**
 * Agent 独立账号管理（仅超管）：名单与 CRM 用户表完全分离。
 * 软删除纪律：只提供停用/启用，不做物理删除，历史对话与审计全保留。
 */
export async function GET() {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const accounts = await prisma.agentAccount.findMany({
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(accounts);
  } catch (error) {
    console.error("[agent-accounts.GET]", error);
    return NextResponse.json({ error: "账号列表加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json().catch(() => null) as
      { username?: unknown; password?: unknown; displayName?: unknown; remark?: unknown; dailyQuota?: unknown } | null;
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const remark = typeof body?.remark === "string" && body.remark.trim() ? body.remark.trim() : null;
    const dailyQuota = Number(body?.dailyQuota ?? 50);

    if (!username || !password || !displayName) {
      return NextResponse.json({ error: "账号、姓名和密码为必填项" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    }
    if (!Number.isInteger(dailyQuota) || dailyQuota < 1 || dailyQuota > 10_000) {
      return NextResponse.json({ error: "每日提问上限必须是 1~10000 的整数" }, { status: 400 });
    }

    const passwordHash = await bcryptjs.hash(password, 12);
    const created = await prisma.$transaction(async (tx) => {
      const account = await tx.agentAccount.create({
        data: { username, passwordHash, displayName, remark, dailyQuota },
        select: ACCOUNT_SELECT,
      });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "CREATE_AGENT_ACCOUNT",
        entityType: "AgentAccount",
        entityId: account.id,
        afterData: { username, displayName, remark, dailyQuota },
      });
      return account;
    });

    return NextResponse.json(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "该账号已存在" }, { status: 409 });
    }
    console.error("[agent-accounts.POST]", error);
    return NextResponse.json({ error: "账号创建失败" }, { status: 500 });
  }
}
