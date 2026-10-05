import type { Prisma } from "@prisma/client";

/**
 * 小川消息反馈（第 2 期段 5）：点赞/点踩落库。
 * 数据按「只加不删、可审计」原则处理：feedback 可反复更改或清除，从不删除消息本身。
 * 点赞的问答后续作为案例沉淀库素材（下期迭代的管理视图）。
 */

export type MessageFeedback = "up" | "down";

export function parseMessageFeedback(input: unknown): MessageFeedback | null | undefined {
  // undefined = 请求未带该字段（参数错误）；null = 清除反馈
  if (input === "up" || input === "down" || input === null) return input;
  return undefined;
}

/** 更新自己会话里某条小川回复的反馈；返回是否命中（false = 消息不存在/非本人/非 assistant 行） */
export async function updateMessageFeedback(
  db: Pick<Prisma.TransactionClient, "agentMessage">,
  owner: { userId: string } | { agentAccountId: string },
  messageId: string,
  feedback: MessageFeedback | null,
): Promise<boolean> {
  const result = await db.agentMessage.updateMany({
    where: {
      id: messageId,
      role: "assistant",
      conversation: owner,
    },
    data: { feedback },
  });
  return result.count > 0;
}
