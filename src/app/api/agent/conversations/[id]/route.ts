import { getXiaochuanViewer, type XiaochuanViewer } from "@/lib/agent/auth";
import { prisma } from "@/lib/db";
import { toProtectedUploadUrl } from "@/lib/upload-urls";
import type { XiaochuanAttachment } from "@/lib/agent/attachments";

export const dynamic = "force-dynamic";

/** 库里存的是逻辑 /uploads/ 路径，回放时统一转成鉴权代理地址 */
function toViewAttachments(value: unknown): Array<XiaochuanAttachment & { viewUrl: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as Partial<XiaochuanAttachment>;
    if (typeof attachment.url !== "string" || typeof attachment.name !== "string") return [];
    return [{
      url: attachment.url,
      name: attachment.name,
      type: typeof attachment.type === "string" ? attachment.type : "application/octet-stream",
      size: typeof attachment.size === "number" ? attachment.size : 0,
      kind: attachment.kind === "pdf" || attachment.kind === "cad" ? attachment.kind : "image",
      viewUrl: toProtectedUploadUrl(attachment.url),
    }];
  });
}

/** 只允许访问自己的对话（CRM 员工与 Agent 独立账号两列各查各的） */
async function requireOwnedConversation(viewer: XiaochuanViewer, conversationId: string) {
  const conversation = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true, agentAccountId: true, title: true, thinkingTier: true, createdAt: true },
  });
  if (!conversation) return null;
  const owned = viewer.kind === "agent-account"
    ? conversation.agentAccountId === viewer.account.id
    : conversation.userId === viewer.user.id;
  return owned ? conversation : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getXiaochuanViewer();
  if (!viewer) return Response.json({ error: "请先登录" }, { status: 401 });

  const { id } = await params;
  const conversation = await requireOwnedConversation(viewer, id);
  if (!conversation) return Response.json({ error: "对话不存在" }, { status: 404 });

  const messages = await prisma.agentMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      role: true,
      content: true,
      attachments: true,
      feedback: true,
      thinkingTier: true,
      toolSummary: true,
      promptTokens: true,
      completionTokens: true,
      durationMs: true,
      error: true,
      createdAt: true,
    },
  });

  return Response.json({
    conversation,
    messages: messages.map((row) => ({ ...row, attachments: toViewAttachments(row.attachments) })),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getXiaochuanViewer();
  if (!viewer) return Response.json({ error: "请先登录" }, { status: 401 });

  const { id } = await params;
  const conversation = await requireOwnedConversation(viewer, id);
  if (!conversation) return Response.json({ error: "对话不存在" }, { status: 404 });

  // 消息表对会话为级联删除，只影响该用户自己的 AI 对话记录
  await prisma.agentConversation.delete({ where: { id } });
  return Response.json({ ok: true });
}
