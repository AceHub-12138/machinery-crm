import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { apiKeyHint, encryptApiKey } from "@/lib/agent/model-config-store";
import { normalizedBaseUrl } from "@/lib/agent/config";

export const dynamic = "force-dynamic";

const CONFIG_SELECT = {
  id: true,
  name: true,
  baseUrl: true,
  model: true,
  apiKeyHint: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/** Agent 模型服务配置（仅超管）：列表不含密钥明文，只含尾四位 hint */
export async function GET() {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const configs = await prisma.agentModelConfig.findMany({
      select: CONFIG_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(configs);
  } catch (error) {
    console.error("[agent-model-configs.GET]", error);
    return NextResponse.json({ error: "配置列表加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json().catch(() => null) as
      { name?: unknown; baseUrl?: unknown; model?: unknown; apiKey?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    let baseUrl: string;
    try {
      baseUrl = normalizedBaseUrl(typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "");
    } catch {
      return NextResponse.json({ error: "接口地址必须是 http(s) 网址" }, { status: 400 });
    }

    if (!name || !model || !apiKey) {
      return NextResponse.json({ error: "名称、模型和 API Key 为必填项" }, { status: 400 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const config = await tx.agentModelConfig.create({
        data: { name, baseUrl, model, apiKeyCipher: encryptApiKey(apiKey), apiKeyHint: apiKeyHint(apiKey) },
        select: CONFIG_SELECT,
      });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "CREATE_AGENT_MODEL_CONFIG",
        entityType: "AgentModelConfig",
        entityId: config.id,
        afterData: { name, baseUrl, model, apiKeyHint: config.apiKeyHint },
      });
      return config;
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error("[agent-model-configs.POST]", error);
    return NextResponse.json({ error: "配置创建失败" }, { status: 500 });
  }
}
