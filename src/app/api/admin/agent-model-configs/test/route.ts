import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { decryptApiKey, testModelConnection } from "@/lib/agent/model-config-store";

export const dynamic = "force-dynamic";

/**
 * 「测试连接」：用提交的地址/密钥/模型发一条最小补全请求（保存前先测，防止改坏生效配置）。
 * 支持两种用法：直接传 baseUrl/model/apiKey 三项，或传已保存配置的 id（复用存量密钥，
 * 但仍以本次表单提交的 baseUrl/model 为准）。
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json().catch(() => null) as
      { id?: unknown; baseUrl?: unknown; model?: unknown; apiKey?: unknown } | null;

    if (typeof body?.id === "string" && body.id) {
      const row = await prisma.agentModelConfig.findUnique({ where: { id: body.id } });
      if (!row) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
      const apiKey = decryptApiKey(row.apiKeyCipher);
      if (!apiKey) return NextResponse.json({ ok: false, message: "密钥解密失败，请重新保存 API Key" }, { status: 400 });
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : row.baseUrl;
      const model = typeof body.model === "string" ? body.model.trim() : row.model;
      if (!baseUrl || !model) {
        return NextResponse.json({ error: "请填写接口地址和模型后再测试" }, { status: 400 });
      }
      const result = await testModelConnection({ baseUrl, apiKey, model });
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
    if (!model || !apiKey || !baseUrl) {
      return NextResponse.json({ error: "请填写接口地址、模型和 API Key 后再测试" }, { status: 400 });
    }
    const result = await testModelConnection({ baseUrl, apiKey, model });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error("[agent-model-configs.TEST]", error);
    return NextResponse.json({ ok: false, message: "测试请求失败，请稍后再试" }, { status: 500 });
  }
}
