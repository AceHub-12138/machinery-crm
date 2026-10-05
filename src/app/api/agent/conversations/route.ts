import { getXiaochuanViewer } from "@/lib/agent/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getXiaochuanViewer();
  if (!viewer) return Response.json({ error: "请先登录" }, { status: 401 });

  const ownerWhere = viewer.kind === "agent-account"
    ? { agentAccountId: viewer.account.id }
    : { userId: viewer.user.id };

  const conversations = await prisma.agentConversation.findMany({
    where: ownerWhere,
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, thinkingTier: true, createdAt: true, updatedAt: true },
  });

  return Response.json({ conversations });
}
