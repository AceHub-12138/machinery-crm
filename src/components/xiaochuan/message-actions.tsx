"use client";

import { useState } from "react";
import { Check, Copy, RefreshCcwIcon, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedbackKind = "up" | "down" | null;

type MessageActionsProps = {
  content: string;
  /** 只有最后一条小川回复允许“重新回答” */
  canRetry: boolean;
  onRetry: () => void;
  /** 段 5：带 messageId 时点赞/点踩落库（案例沉淀素材） */
  messageId?: string;
  initialFeedback?: FeedbackKind;
};

function ActionButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
        active && "bg-orange-50 text-[#ee7d2c] dark:bg-orange-500/10",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 小川回复下方的操作条：复制 / 重新回答 / 点赞 / 点踩。
 * 按用户拍板不含「分享」（内部平台不外传业务数据）。
 * 点赞/点踩（段 5）落库：只存"这条回答有没有帮助"，用于沉淀案例库素材。
 */
export function MessageActions({ content, canRetry, onRetry, messageId, initialFeedback = null }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackKind>(initialFeedback);

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // 剪贴板不可用时静默
    }
  }

  function toggleFeedback(kind: "up" | "down") {
    const next = feedback === kind ? null : kind;
    const previous = feedback;
    setFeedback(next);
    if (!messageId) return;
    fetch(`/api/agent/messages/${messageId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedback: next }),
    }).catch(() => {
      // 失败回滚为点击前的状态（网络问题不打断使用）
      setFeedback(previous);
    });
  }

  return (
    <div className="flex items-center gap-0.5">
      <ActionButton label={copied ? "已复制" : "复制"} onClick={() => void copyContent()}>
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </ActionButton>
      {canRetry && (
        <ActionButton label="重新回答" onClick={onRetry}>
          <RefreshCcwIcon className="size-3.5" />
        </ActionButton>
      )}
      <ActionButton
        label="有帮助"
        active={feedback === "up"}
        onClick={() => toggleFeedback("up")}
      >
        <ThumbsUp className="size-3.5" />
      </ActionButton>
      <ActionButton
        label="没帮助"
        active={feedback === "down"}
        onClick={() => toggleFeedback("down")}
      >
        <ThumbsDown className="size-3.5" />
      </ActionButton>
    </div>
  );
}
