import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { apiKeyHint, encryptApiKey } from "@/lib/agent/model-config-store";
import { clearExternalMcpCache } from "@/lib/agent/mcp-external";

export const dynamic = "force-dynamic";

const SERVER_SELECT = {
  id: true,
  name: true,
  url: true,
  apiKeyHint: true,
  isEnabled: true,
  createdAt: true,
};

export async function GET() {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const servers = await prisma.agentMcpServer.findMany({ select: SERVER_SELECT, orderBy: { createdAt: "asc" } });
    return NextResponse.json(servers);
  } catch (error) {
    console.error("[agent-mcp-servers.GET]", error);
    return NextResponse.json({ error: "外部 MCP 列表加载失败" }, { status: 500 });
  }
}

/** 新增外部 MCP 服务（含预置模板快捷创建）；URL 支持 {API_KEY} 占位符；不填 Key 的服务免鉴权直连 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json().catch(() => null) as
      { name?: unknown; url?: unknown; apiKey?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

    if (!name || !url) return NextResponse.json({ error: "名称和接口地址为必填项" }, { status: 400 });
    try {
      const parsed = new URL(url.replaceAll("{API_KEY}", "placeholder"));
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("protocol");
    } catch {
      return NextResponse.json({ error: "接口地址必须是 http(s) 网址" }, { status: 400 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const server = await tx.agentMcpServer.create({
        data: {
          name,
          url,
          ...(apiKey
            ? { apiKeyCipher: encryptApiKey(apiKey), apiKeyHint: apiKeyHint(apiKey) }
            : {}),
        },
        select: SERVER_SELECT,
      });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "CREATE_AGENT_MCP_SERVER",
        entityType: "AgentMcpServer",
        entityId: server.id,
        afterData: { name, url, apiKeyHint: server.apiKeyHint },
      });
      return server;
    });
    clearExternalMcpCache();

    return NextResponse.json(created);
  } catch (error) {
    console.error("[agent-mcp-servers.POST]", error);
    return NextResponse.json({ error: "外部 MCP 新增失败" }, { status: 500 });
  }
}
