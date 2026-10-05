import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { decryptApiKey, } from "@/lib/agent/model-config-store";
import { resolveServerUrl, testExternalMcpServer } from "@/lib/agent/mcp-external";

export const dynamic = "force-dynamic";

/**
 * 「测试连接」外部 MCP：直连并列出工具。
 * 两种用法：传 url+apiKey（保存前先测）或传已保存配置 id（用存量 Key 测）。
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json().catch(() => null) as
      { id?: unknown; url?: unknown; apiKey?: unknown } | null;

    if (typeof body?.id === "string" && body.id) {
      const row = await prisma.agentMcpServer.findUnique({ where: { id: body.id } });
      if (!row) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
      const apiKey = row.apiKeyCipher ? decryptApiKey(row.apiKeyCipher) : null;
      const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : row.url;
      try {
        const resolved = resolveServerUrl(url, apiKey);
        const result = await testExternalMcpServer(resolved, url.includes("{API_KEY}") ? null : apiKey);
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      } catch (error) {
        return NextResponse.json(
          { ok: false, message: error instanceof Error ? error.message : "地址无效" },
          { status: 400 },
        );
      }
    }

    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!url) return NextResponse.json({ error: "请填写接口地址后再测试" }, { status: 400 });

    try {
      const needsKey = url.includes("{API_KEY}");
      if (needsKey && !apiKey) {
        return NextResponse.json({ ok: false, message: "该服务地址包含 {API_KEY} 占位符，请先填写 API Key" }, { status: 400 });
      }
      const resolved = resolveServerUrl(url, apiKey || null);
      const result = await testExternalMcpServer(resolved, apiKey || null);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    } catch (error) {
      return NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : "地址无效" },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("[agent-mcp-servers.TEST]", error);
    return NextResponse.json({ ok: false, message: "测试请求失败，请稍后再试" }, { status: 500 });
  }
}
