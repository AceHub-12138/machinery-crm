import { prisma } from "@/lib/db";

/** 必须在新消息写入前校验，不能通过提交他人的历史 URL 给自己建立归属。 */
export async function ownsLegacyXiaochuanUpload(userId: string, url: string) {
  return Boolean(await prisma.agentMessage.findFirst({
    where: { conversation: { userId }, attachments: { path: "$[*].url", array_contains: [url] } },
    select: { id: true },
  }));
}
