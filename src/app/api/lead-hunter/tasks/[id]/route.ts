import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { createLeadHunterEngine } from "@/lib/lead-hunter/engine";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });

    const { id } = await params;

    // 服务重启中断兜底：running 且心跳超时的任务标 failed，页面可重新执行
    await createLeadHunterEngine({ prisma }).markInterruptedIfStale(id);

    const task = await prisma.leadHuntTask.findUnique({
      where: { id },
      include: { candidates: { orderBy: [{ score: "desc" }, { createdAt: "asc" }] } },
    });
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    const statusCounts = await prisma.leadHuntCandidate.groupBy({
      by: ["status"],
      where: { taskId: id },
      _count: { _all: true },
    });
    const stats: Record<string, number> = {};
    for (const row of statusCounts) stats[row.status] = row._count._all;

    return NextResponse.json({ task, stats });
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[lead-hunter.task.GET]", error);
    return NextResponse.json({ error: "读取任务失败" }, { status: 500 });
  }
}
