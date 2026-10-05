import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { createLeadHunterEngine } from "@/lib/lead-hunter/engine";
import { isDomainError } from "@/modules/shared/domain-error";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });

    const { id } = await params;
    const engine = createLeadHunterEngine({ prisma });
    const cancelled = await engine.cancelTask(id);
    if (!cancelled) {
      // 不在本进程运行：可能是服务重启遗留的 running，直接落库取消
      const task = await prisma.leadHuntTask.findUnique({ where: { id }, select: { status: true } });
      if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      if (task.status !== "running") return NextResponse.json({ error: "任务不在进行中" }, { status: 400 });
      await prisma.leadHuntTask.updateMany({ where: { id, status: "running" }, data: { status: "cancelled", error: "用户取消" } });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[lead-hunter.cancel.POST]", error);
    return NextResponse.json({ error: "取消任务失败" }, { status: 500 });
  }
}
