import { getXiaochuanViewer } from "@/lib/agent/auth";
import { prisma } from "@/lib/db";
import { parseMessageFeedback, updateMessageFeedback } from "@/lib/agent/feedback";

export const dynamic = "force-dynamic";

/** 小川回复的点赞/点踩（段 5）：只允许操作自己会话里的 assistant 行。 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getXiaochuanViewer();
  if (!viewer) return Response.json({ error: "请先登录" }, { status: 401 });
  const owner = viewer.kind === "agent-account"
    ? { agentAccountId: viewer.account.id }
    : { userId: viewer.user.id };

  let body: { feedback?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }
  const feedback = parseMessageFeedback(body.feedback);
  if (feedback === undefined) {
    return Response.json({ error: "feedback 必须是 up / down / null" }, { status: 400 });
  }

  const { id } = await params;
  const updated = await updateMessageFeedback(prisma, owner, id, feedback);
  if (!updated) return Response.json({ error: "消息不存在" }, { status: 404 });
  return Response.json({ ok: true, feedback });
}
