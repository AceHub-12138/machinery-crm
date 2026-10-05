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

/** 编辑外部 MCP 服务：名称/地址/API Key（留空=保持不变）/启用停用 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.agentMcpServer.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "配置不存在" }, { status: 404 });

    const body = await request.json().catch(() => null) as
      { name?: unknown; url?: unknown; apiKey?: unknown; isEnabled?: unknown } | null;
    if (!body) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });

    const data: { name?: string; url?: string; apiKeyCipher?: string; apiKeyHint?: string; isEnabled?: boolean } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
      data.name = name;
    }
    if (body.url !== undefined) {
      const url = String(body.url).trim();
      try {
        new URL(url.replaceAll("{API_KEY}", "placeholder"));
      } catch {
        return NextResponse.json({ error: "接口地址必须是 http(s) 网址" }, { status: 400 });
      }
      data.url = url;
    }
    if (body.apiKey !== undefined && String(body.apiKey).trim()) {
      const apiKey = String(body.apiKey).trim();
      data.apiKeyCipher = encryptApiKey(apiKey);
      data.apiKeyHint = apiKeyHint(apiKey);
    }
    if (body.isEnabled !== undefined) data.isEnabled = body.isEnabled === true;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有需要修改的内容" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const server = await tx.agentMcpServer.update({ where: { id }, data, select: SERVER_SELECT });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "UPDATE_AGENT_MCP_SERVER",
        entityType: "AgentMcpServer",
        entityId: id,
        beforeData: { name: existing.name, url: existing.url, isEnabled: existing.isEnabled, apiKeyHint: existing.apiKeyHint },
        afterData: { name: server.name, url: server.url, isEnabled: server.isEnabled, apiKeyHint: server.apiKeyHint },
      });
      return server;
    });
    clearExternalMcpCache();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[agent-mcp-servers.PATCH]", error);
    return NextResponse.json({ error: "外部 MCP 更新失败" }, { status: 500 });
  }
}

/** 删除外部 MCP 服务（配置本身可物理删除，不涉及业务数据；删除写操作日志） */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSessionUser();
    if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(admin)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.agentMcpServer.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "配置不存在" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.agentMcpServer.delete({ where: { id } });
      await writeOperationLog(tx, {
        userId: admin.id,
        action: "DELETE_AGENT_MCP_SERVER",
        entityType: "AgentMcpServer",
        entityId: id,
        beforeData: { name: existing.name, url: existing.url, isEnabled: existing.isEnabled },
      });
    });
    clearExternalMcpCache();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[agent-mcp-servers.DELETE]", error);
    return NextResponse.json({ error: "外部 MCP 删除失败" }, { status: 500 });
  }
}
