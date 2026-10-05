import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { createLeadHunterEngine } from "@/lib/lead-hunter/engine";
import { createTianyanchaClient } from "@/lib/lead-hunter/tianyancha";
import { leadHuntConfigSchema } from "@/lib/lead-hunter/types";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });

  const tasks = await prisma.leadHuntTask.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      config: true,
      progress: true,
      report: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { candidates: true } },
    },
  });
  const admittedCounts = await prisma.leadHuntCandidate.groupBy({
    by: ["taskId"],
    where: { task: { id: { in: tasks.map((task) => task.id) } }, status: "ADMITTED" },
    _count: { _all: true },
  });
  const admittedByTask = new Map(admittedCounts.map((row) => [row.taskId, row._count._all]));

  return NextResponse.json({
    tasks: tasks.map((task) => ({ ...task, admittedCount: admittedByTask.get(task.id) ?? 0 })),
    // 前端据此提示「真实搜索会消耗百度千帆每日额度」还是「假搜索演示模式」
    fakeSearchMode: process.env.LEAD_HUNTER_FAKE_SEARCH?.trim() === "1",
  });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });

    const parsed = leadHuntConfigSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "任务参数不合法" }, { status: 400 });
    }

    const task = await prisma.leadHuntTask.create({
      data: {
        status: "running",
        config: parsed.data as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });

    // 服务端异步执行：状态全部落库，前端每 3 秒轮询任务详情
    createLeadHunterEngine({ prisma, tianyancha: createTianyanchaClient() }).startTask(task.id);

    return NextResponse.json({ id: task.id });
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[lead-hunter.tasks.POST]", error);
    return NextResponse.json({ error: "创建获客任务失败" }, { status: 500 });
  }
}
