import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { clearModelConfigCache } from "@/lib/agent/model-config-store";

export const dynamic = "force-dynamic";

/** 切换生效配置：事务内全局唯一生效，成功后立即清除运行时缓存（新配置即时生效，无需重新部署） */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const target = await prisma.agentModelConfig.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "配置不存在" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.agentModelConfig.updateMany({ data: { isActive: false } });
      await tx.agentModelConfig.update({ where: { id }, data: { isActive: true } });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "ACTIVATE_AGENT_MODEL_CONFIG",
        entityType: "AgentModelConfig",
        entityId: id,
        beforeData: null,
        afterData: { name: target.name, baseUrl: target.baseUrl, model: target.model, apiKeyHint: target.apiKeyHint },
      });
    });
    clearModelConfigCache();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[agent-model-configs.ACTIVATE]", error);
    return NextResponse.json({ error: "切换生效配置失败" }, { status: 500 });
  }
}
