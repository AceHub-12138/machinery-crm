import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { apiKeyHint, clearModelConfigCache, encryptApiKey } from "@/lib/agent/model-config-store";
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

/** 编辑模型配置：名称/接口地址/模型/API Key（Key 留空=保持不变） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.agentModelConfig.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "配置不存在" }, { status: 404 });

    const body = await request.json().catch(() => null) as
      { name?: unknown; baseUrl?: unknown; model?: unknown; apiKey?: unknown } | null;
    if (!body) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });

    const data: {
      name?: string;
      baseUrl?: string;
      model?: string;
      apiKeyCipher?: string;
      apiKeyHint?: string;
    } = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
      data.name = name;
    }
    if (body.baseUrl !== undefined) {
      try {
        data.baseUrl = normalizedBaseUrl(String(body.baseUrl).trim());
      } catch {
        return NextResponse.json({ error: "接口地址必须是 http(s) 网址" }, { status: 400 });
      }
    }
    if (body.model !== undefined) {
      const model = String(body.model).trim();
      if (!model) return NextResponse.json({ error: "模型不能为空" }, { status: 400 });
      data.model = model;
    }
    if (body.apiKey !== undefined && String(body.apiKey).trim()) {
      const apiKey = String(body.apiKey).trim();
      data.apiKeyCipher = encryptApiKey(apiKey);
      data.apiKeyHint = apiKeyHint(apiKey);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有需要修改的内容" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const config = await tx.agentModelConfig.update({ where: { id }, data, select: CONFIG_SELECT });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "UPDATE_AGENT_MODEL_CONFIG",
        entityType: "AgentModelConfig",
        entityId: id,
        beforeData: { name: existing.name, baseUrl: existing.baseUrl, model: existing.model, apiKeyHint: existing.apiKeyHint },
        afterData: { name: config.name, baseUrl: config.baseUrl, model: config.model, apiKeyHint: config.apiKeyHint },
      });
      return config;
    });
    if (existing.isActive) clearModelConfigCache();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[agent-model-configs.PATCH]", error);
    return NextResponse.json({ error: "配置更新失败" }, { status: 500 });
  }
}

/** 删除配置：仅允许删除非生效配置；生效中的配置必须先切换到其他配置（防误删导致小川断粮） */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.agentModelConfig.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    if (existing.isActive) {
      return NextResponse.json({ error: "该配置正在生效中，请先切换到其他配置再删除" }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.agentModelConfig.delete({ where: { id } });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "DELETE_AGENT_MODEL_CONFIG",
        entityType: "AgentModelConfig",
        entityId: id,
        beforeData: { name: existing.name, baseUrl: existing.baseUrl, model: existing.model, apiKeyHint: existing.apiKeyHint },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[agent-model-configs.DELETE]", error);
    return NextResponse.json({ error: "配置删除失败" }, { status: 500 });
  }
}
