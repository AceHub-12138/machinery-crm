"use client";

import { Bot, ChevronDown, Send } from "lucide-react";
import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { AgentChatError, AgentChatMessage, streamAgentChat } from "@/lib/agent-chat";
import { MarkdownContent } from "@/components/xiaochuan/markdown-content";
import { AgentAvatar, AgentExpression, AgentPresence } from "./AgentAvatar";

type ChatPanelProps = {
  expression: AgentExpression;
  presence: AgentPresence;
  onClose: () => void;
  onMessageSubmit: () => void;
  onRestorePet: () => void;
};

type PanelSize = {
  height: number;
  width: number;
};

type ResizeState = PanelSize & {
  pointerX: number;
  pointerY: number;
};

type ChatMessage = AgentChatMessage & {
  id: string;
};

const MIN_PANEL_HEIGHT = 352;
const MIN_PANEL_WIDTH = 320;
const VIEWPORT_GUTTER = 32;

export function ChatPanel({
  expression,
  presence,
  onClose,
  onMessageSubmit,
  onRestorePet,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [panelSize, setPanelSize] = useState<PanelSize | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || isSending) return;

    const userMessage: ChatMessage = {
      content,
      id: `user-${Date.now()}`,
      role: "user",
    };
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      content: "",
      id: assistantMessageId,
      role: "assistant",
    };
    const conversation = [...messages, userMessage].map(({ content: messageContent, role }) => ({
      content: messageContent,
      role,
    }));

    onMessageSubmit();
    setInput("");
    setErrorMessage("");
    setIsSending(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      await streamAgentChat(conversation, (token) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: message.content + token }
              : message,
          ),
        );
      });
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== assistantMessageId));
      if (error instanceof AgentChatError) {
        if (error.kind === "configuration") {
          setErrorMessage("Agent 应用尚未配置，请联系管理员。");
        } else if (error.status === 401) {
          setErrorMessage("登录状态已失效，请重新登录后再试。");
        } else if (error.status === 403) {
          setErrorMessage("当前账号没有使用 Agent 的权限。");
        } else if (error.status === 429) {
          setErrorMessage("请求过于频繁，请稍后重试。");
        } else {
          setErrorMessage("Agent 暂时无法响应，请稍后重试。");
        }
      } else {
        setErrorMessage("网络连接失败，请检查网络后重试。");
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleResizePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = panel.getBoundingClientRect();
    resizeStateRef.current = {
      height: bounds.height,
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: bounds.width,
    };
  }

  function handleResizePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const resizeState = resizeStateRef.current;
    if (!resizeState) return;

    setPanelSize({
      height: Math.min(
        Math.max(resizeState.height - (event.clientY - resizeState.pointerY), MIN_PANEL_HEIGHT),
        window.innerHeight - VIEWPORT_GUTTER,
      ),
      width: Math.min(
        Math.max(resizeState.width - (event.clientX - resizeState.pointerX), MIN_PANEL_WIDTH),
        window.innerWidth - VIEWPORT_GUTTER,
      ),
    });
  }

  function handleResizePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStateRef.current = null;
  }

  return (
    <section
      ref={panelRef}
      aria-label="小川 Ai 助手聊天面板"
      style={panelSize ?? undefined}
      className="fixed inset-x-5 bottom-5 z-40 flex h-[min(34rem,calc(100dvh-2.5rem))] max-h-[calc(100dvh-2.5rem)] min-h-[22rem] flex-col overflow-hidden rounded-3xl border border-orange-100 bg-white shadow-[0_24px_60px_rgba(17,24,39,0.22)] print:hidden sm:left-auto sm:right-5 sm:w-[380px] sm:min-w-[320px] sm:max-w-[calc(100vw-2.5rem)] lg:right-6"
    >
      <button
        type="button"
        aria-label="拖动调整聊天窗口大小"
        title="拖动调整窗口大小"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        className="absolute left-0 top-0 z-10 hidden size-9 touch-none cursor-nwse-resize items-center justify-center rounded-br-xl text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:flex"
      >
        <span aria-hidden="true" className="grid size-3 grid-cols-2 gap-0.5">
          <span className="rounded-sm bg-current" />
          <span className="rounded-sm bg-current" />
          <span className="rounded-sm bg-current" />
          <span className="rounded-sm bg-current" />
        </span>
      </button>
      <header className="flex items-center justify-between border-b border-orange-100 bg-gradient-to-r from-orange-50 to-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-orange-100">
            <AgentAvatar
              expression={expression}
              presence={presence}
              alt="小川 Ai 助手头像"
              className="size-full"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">小川 Ai 助手</p>
            <p className="text-xs text-orange-600">智能助手 · 在线对话</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRestorePet}
            aria-label="恢复站立桌宠"
            title="恢复站立桌宠"
            className="inline-flex size-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <Bot className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="收起小川 Ai 助手聊天面板"
            className="inline-flex size-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <ChevronDown className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-white to-orange-50/40 p-4">
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-[15rem] flex-col items-center text-center">
            <div className="mb-3 flex size-16 items-center justify-center overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-orange-100">
              <AgentAvatar expression={expression} presence={presence} alt="" className="size-full" />
            </div>
            <p className="text-sm font-medium text-gray-800">你好，我是小川 Ai 助手</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">可以向我咨询 CRM 与 ERP 的使用问题</p>
          </div>
        ) : (
          <div className="space-y-3" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm ${
                    message.role === "user"
                      ? "whitespace-pre-wrap rounded-br-md bg-[#ee7d2c] text-white"
                      : "rounded-bl-md bg-white text-gray-800 ring-1 ring-orange-100"
                  }`}
                >
                  {message.role === "assistant" && message.content ? (
                    <MarkdownContent content={message.content} />
                  ) : (
                    message.content || (isSending ? "正在思考…" : "")
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-orange-100 bg-white p-3">
        {errorMessage && (
          <p role="alert" className="mb-2 px-1 text-xs text-red-600">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-1.5 focus-within:border-orange-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入消息"
            aria-label="输入给 Agent 的消息"
            disabled={isSending}
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
          <button
            type="submit"
            aria-label="发送消息"
            disabled={isSending || !input.trim()}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ee7d2c] text-white transition-colors hover:bg-[#d9691a] disabled:cursor-not-allowed disabled:bg-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
          >
            <Send className="size-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
