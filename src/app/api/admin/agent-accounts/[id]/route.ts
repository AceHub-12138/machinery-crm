import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
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

/** 编辑 Agent 独立账号：姓名/备注/每日额度/重置密码/停用启用（不做物理删除，只加不删） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.agentAccount.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "账号不存在" }, { status: 404 });

    const body = await request.json().catch(() => null) as
      { displayName?: unknown; remark?: unknown; dailyQuota?: unknown; isActive?: unknown; password?: unknown } | null;
    if (!body) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });

    const data: {
      displayName?: string;
      remark?: string | null;
      dailyQuota?: number;
      isActive?: boolean;
      passwordHash?: string;
      sessionVersion?: { increment: number };
    } = {};

    if (body.displayName !== undefined) {
      const displayName = String(body.displayName).trim();
      if (!displayName) return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
      data.displayName = displayName;
    }
    if (body.remark !== undefined) {
      const remark = String(body.remark).trim();
      data.remark = remark ? remark : null;
    }
    if (body.dailyQuota !== undefined) {
      const dailyQuota = Number(body.dailyQuota);
      if (!Number.isInteger(dailyQuota) || dailyQuota < 1 || dailyQuota > 10_000) {
        return NextResponse.json({ error: "每日提问上限必须是 1~10000 的整数" }, { status: 400 });
      }
      data.dailyQuota = dailyQuota;
    }
    if (body.isActive !== undefined) {
      data.isActive = body.isActive === true;
    }
    if (body.password !== undefined && body.password !== null && String(body.password).length > 0) {
      const password = String(body.password);
      if (password.length < 8) {
        return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
      }
      data.passwordHash = await bcryptjs.hash(password, 12);
      data.sessionVersion = { increment: 1 };
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有需要修改的内容" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const account = await tx.agentAccount.update({ where: { id }, data, select: ACCOUNT_SELECT });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: data.passwordHash ? "RESET_AGENT_ACCOUNT_PASSWORD" : "UPDATE_AGENT_ACCOUNT",
        entityType: "AgentAccount",
        entityId: id,
        beforeData: {
          displayName: existing.displayName,
          remark: existing.remark,
          dailyQuota: existing.dailyQuota,
          isActive: existing.isActive,
        },
        afterData: { ...data, passwordHash: data.passwordHash ? "(已重置)" : undefined },
      });
      return account;
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[agent-accounts.PATCH]", error);
    return NextResponse.json({ error: "账号更新失败" }, { status: 500 });
  }
}
