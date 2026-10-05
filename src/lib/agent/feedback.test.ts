import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { parseMessageFeedback, updateMessageFeedback } from "@/lib/agent/feedback";

describe("parseMessageFeedback", () => {
  it("接受 up / down / null，其余为 undefined（参数错误）", () => {
    expect(parseMessageFeedback("up")).toBe("up");
    expect(parseMessageFeedback("down")).toBe("down");
    expect(parseMessageFeedback(null)).toBeNull();
    expect(parseMessageFeedback(undefined)).toBeUndefined();
    expect(parseMessageFeedback("like")).toBeUndefined();
    expect(parseMessageFeedback(1)).toBeUndefined();
  });
});

describe("updateMessageFeedback", () => {
  function db(count: number) {
    const updateMany = vi.fn(async (_args?: { data?: { feedback: string | null } }) => ({ count }));
    const client = { agentMessage: { updateMany } } as unknown as Pick<Prisma.TransactionClient, "agentMessage">;
    return { client, updateMany };
  }

  it("只更新本人会话内的 assistant 行（条件由 where 下推）", async () => {
    const mock = db(1);
    const updated = await updateMessageFeedback(mock.client, { userId: "user-1" }, "msg-1", "up");

    expect(updated).toBe(true);
    expect(mock.updateMany).toHaveBeenCalledWith({
      where: { id: "msg-1", role: "assistant", conversation: { userId: "user-1" } },
      data: { feedback: "up" },
    });
  });

  it("消息不存在/非本人/非 assistant 行时返回 false", async () => {
    const mock = db(0);
    const updated = await updateMessageFeedback(mock.client, { userId: "user-1" }, "msg-x", null);
    expect(updated).toBe(false);
  });

  it("feedback=null 表示清除评价，同样可写库", async () => {
    const mock = db(1);
    await updateMessageFeedback(mock.client, { userId: "user-1" }, "msg-1", null);
    expect(mock.updateMany.mock.calls[0][0]?.data).toEqual({ feedback: null });
  });
});
