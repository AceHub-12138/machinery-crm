import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { createLeadHunterEngine } from "@/lib/lead-hunter/engine";
import { createTianyanchaClient } from "@/lib/lead-hunter/tianyancha";
import { isDomainError } from "@/modules/shared/domain-error";

/** 重新执行：以此任务的配置新建一个任务从头跑（旧任务的候选与报告原样保留，不删任何数据） */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });

    const { id } = await params;
    const source = await prisma.leadHuntTask.findUnique({ where: { id }, select: { config: true } });
    if (!source) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    const task = await prisma.leadHuntTask.create({
      data: {
        status: "running",
        config: source.config as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
    createLeadHunterEngine({ prisma, tianyancha: createTianyanchaClient() }).startTask(task.id);

    return NextResponse.json({ id: task.id });
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[lead-hunter.rerun.POST]", error);
    return NextResponse.json({ error: "重新执行失败" }, { status: 500 });
  }
}
