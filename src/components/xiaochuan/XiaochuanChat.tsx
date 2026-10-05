"use client";

import nextDynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { LogOut, MessageSquarePlus, PanelLeft, Trash2, FileText, X, ChevronDown, Loader2 } from "lucide-react";
import { AgentAvatar } from "@/components/dachuan-pet/AgentAvatar";
import { ThemeControl } from "@/components/layout/theme-control";
import { UserAvatar } from "@/components/layout/user-avatar";
import { MessageActions } from "@/components/xiaochuan/message-actions";
import { MarkdownContent } from "@/components/xiaochuan/markdown-content";
import { Spotlight } from "@/components/xiaochuan/spotlight";
import {
  XiaochuanInput,
  type AttachmentView,
  type ThinkingTier,
} from "@/components/xiaochuan/xiaochuan-input";
import { PLATFORM_HOME_URL } from "@/lib/agent/site-url";
import { PDF_PAGE_RENDER_LIMIT, renderPdfPagesToImages } from "@/lib/xiaochuan/pdf-page-render";
import type { XiaochuanViewerView } from "@/lib/agent/auth";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/agent/attachments";
import { toProtectedUploadUrl } from "@/lib/upload-urls";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";

// Spline 3D 仅在浏览器端加载（占位用演示机器人，待小川专属场景后替换 SPLINE_SCENE_URL）
const SplineScene = nextDynamic(() => import("@/components/xiaochuan/spline-scene").then((mod) => mod.SplineScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <span
        aria-label="3D 模型加载中"
        className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-[#ee7d2c]"
      />
    </div>
  ),
});

type ToolEventView = { tool: string; ok: boolean };

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  /** 混合推理模型的思考内容（仅当轮流式展示，不落库；刷新后消失） */
  reasoning?: string;
  /** 思考已结束（正文开始输出/工具开始调用/回答完成） */
  reasoningFinished?: boolean;
  toolEvents?: ToolEventView[];
  error?: boolean;
  attachments?: AttachmentView[];
  feedback?: "up" | "down" | null;
};

type ConversationItem = {
  id: string;
  title: string;
  updatedAt: string;
};

const SUGGESTIONS = [
  "这个月成交了多少合同？",
  "现在有哪些库存预警？",
  "最近一周发货了哪些设备？",
];

const TOOL_LABELS: Record<string, string> = {
  lead_list: "AI 线索池",
  lead_get: "线索详情",
  lead_stats: "线索统计",
  crm_customers_list: "客户列表",
  crm_customer_get: "客户详情",
  crm_customer_follows_list: "跟进记录",
  crm_products_list: "产品库",
  crm_product_get: "产品详情",
  crm_contracts_list: "合同列表",
  crm_contract_get: "合同详情",
  crm_shipments_list: "发货记录",
  crm_shipment_get: "发货详情",
  erp_suppliers_list: "供应商",
  erp_supplier_get: "供应商详情",
  erp_purchase_orders_list: "采购订单",
  erp_purchase_order_get: "采购订单详情",
  erp_inventory_list: "库存",
  erp_stock_documents_list: "出入库单",
  erp_stock_movements_list: "库存流水",
  erp_boms_list: "整机用料清单",
  erp_bom_get: "用料清单详情",
  erp_production_orders_list: "生产工单",
  erp_production_order_get: "工单详情",
  erp_kit_check: "齐套检查",
};

function toolDisplayName(tool: string) {
  return TOOL_LABELS[tool] ?? tool;
}

const ATTACHMENT_KIND_LABELS = { image: "图片", pdf: "PDF", cad: "CAD" } as const;

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

/** 用户消息附件：图片出缩略图（点击新窗口看原图），文件出卡片。viewUrl 走鉴权代理 */
function MessageAttachments({ attachments }: { attachments: AttachmentView[] }) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {attachments.map((attachment, index) => (
        attachment.kind === "image" ? (
          <a
            key={`${attachment.url}-${index}`}
            href={toProtectedUploadUrl(attachment.url)}
            target="_blank"
            rel="noreferrer"
            title={`${attachment.name}（点击看原图）`}
            className="block overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-700"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={toProtectedUploadUrl(attachment.url)}
              alt={attachment.name}
              className="max-h-44 max-w-56 object-cover"
            />
          </a>
        ) : (
          <a
            key={`${attachment.url}-${index}`}
            href={toProtectedUploadUrl(attachment.url)}
            target="_blank"
            rel="noreferrer"
            title={`${attachment.name}（点击打开）`}
            className={cn(
              "inline-flex max-w-56 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm transition-colors hover:border-[#ee7d2c]/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
            )}
          >
            <FileText className="size-4 shrink-0 text-[#ee7d2c]" />
            <span className="min-w-0">
              <span className="block truncate">{attachment.name}</span>
              <span className="text-[10px] text-gray-400">
                {ATTACHMENT_KIND_LABELS[attachment.kind]} · {formatAttachmentSize(attachment.size)}
              </span>
            </span>
          </a>
        )
      ))}
    </div>
  );
}

/** 小川的思考过程面板：思考中自动展开直播，结束后折叠为一行可展开记录 */
function ReasoningPanel({ text, active }: { text: string; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const open = active || expanded;
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={active ? undefined : () => setExpanded((current) => !current)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors",
          active
            ? "bg-orange-50 text-[#b3591a] dark:bg-orange-500/10 dark:text-orange-300"
            : "bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800",
        )}
      >
        {active ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />}
        {active ? "小川正在思考…" : "思考过程"}
      </button>
      {open && (
        <div className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5 text-xs leading-relaxed text-gray-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
          {text}
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function XiaochuanChat({ viewer }: { viewer: XiaochuanViewerView }) {
  const isAgentAccount = viewer.kind === "agent-account";
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tier, setTier] = useState<ThinkingTier>("fast");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userAvatarPath, setUserAvatarPath] = useState<string>("");
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentView[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const isEmpty = messages.length === 0;

  // 深色 hero ↔ 对话视图切换时的 GSAP 过渡（尊重系统"减少动态效果"偏好）
  useEffect(() => {
    if (!viewRef.current) return;
    if (reducedMotion) return;
    gsap.fromTo(
      viewRef.current,
      { opacity: 0, y: 14, scale: 0.995 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out", overwrite: "auto" },
    );
  }, [isEmpty, reducedMotion]);

  const refreshConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/conversations", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { conversations?: ConversationItem[] };
      setConversations(payload.conversations ?? []);
    } catch {
      // 列表加载失败不阻塞对话
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // 对话记录栏：小屏默认收起（抽屉式），桌面恢复上次的展开/收起偏好
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      } else {
        const stored = localStorage.getItem("dachuan.xiaochuan.sidebar");
        if (stored !== null) setSidebarOpen(stored === "true");
      }
    } catch {
      // 存储不可用时保持默认
    }
  }, []);

  /** 仅在移动端收起抽屉；桌面侧栏保持原状 */
  function closeMobileDrawer() {
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  }

  function toggleSidebar() {
    setSidebarOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem("dachuan.xiaochuan.sidebar", String(next));
      } catch {
        // 忽略存储失败
      }
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/upload/avatar", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { avatarPath?: string } | null) => setUserAvatarPath(data?.avatarPath || ""))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  async function openConversation(id: string) {
    if (streaming) return;
    setActiveId(id);
    closeMobileDrawer();
    setMessages([]);
    try {
      const response = await fetch(`/api/agent/conversations/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as {
        messages?: Array<{
          id: string;
          role: string;
          content: string;
          error?: boolean | null;
          toolSummary?: Array<{ tool: string; ok: boolean }> | null;
          attachments?: Array<{ url: string; name: string; type?: string; kind?: string; size?: number }> | null;
          feedback?: string | null;
        }>;
      };
      setMessages((payload.messages ?? []).map((row) => ({
        id: row.id,
        role: row.role === "assistant" ? "assistant" : "user",
        content: row.content,
        error: row.error === true,
        toolEvents: row.toolSummary?.map((tool) => ({ tool: tool.tool, ok: tool.ok })),
        attachments: (row.attachments ?? []).map((attachment) => ({
          url: attachment.url,
          name: attachment.name,
          type: attachment.type ?? "application/octet-stream",
          kind: attachment.kind === "pdf" || attachment.kind === "cad" ? attachment.kind : "image",
          size: attachment.size ?? 0,
        })),
        feedback: row.feedback === "up" || row.feedback === "down" ? row.feedback : null,
      })));
    } catch {
      // 保持空列表
    }
  }

  async function deleteConversation(id: string) {
    if (streaming) return;
    try {
      await fetch(`/api/agent/conversations/${id}`, { method: "DELETE" });
    } catch {
      // 删除失败静默，下次刷新可见
    }
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    void refreshConversations();
  }

  function startNewConversation() {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    closeMobileDrawer();
  }

  /** 段 2：附件先上传拿 url，成功后进待发区；失败给行内提示 */
  async function handleFilesSelected(files: File[]) {
    setUploadError("");
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
    if (room <= 0) {
      setUploadError(`每条消息最多 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件`);
      return;
    }
    const selected = files.slice(0, room);
    if (files.length > room) setUploadError(`一次最多再带 ${room} 个附件，多出的已忽略`);
    setUploadingCount((current) => current + selected.length);
    // 派生页图片的总预算：本批文件占用的名额之外，剩余名额留给 PDF 图纸页面图
    let derivedBudget = room - selected.length;
    for (const file of selected) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/upload/xiaochuan", { method: "POST", body: formData });
        const payload = await response.json().catch(() => null) as
          { url?: string; name?: string; type?: string; kind?: string; size?: number; error?: string } | null;
        if (!response.ok || !payload?.url) {
          setUploadError(payload?.error || "文件上传失败，请稍后再试");
        } else {
          setPendingAttachments((current) => [...current, {
            url: payload.url!,
            name: payload.name ?? file.name,
            type: payload.type ?? file.type ?? "application/octet-stream",
            kind: payload.kind === "pdf" || payload.kind === "cad" ? payload.kind : "image",
            size: payload.size ?? file.size,
          }]);
          // 一期新增：PDF 在浏览器里逐页转成图片后一并上传，走视觉通道识别图纸画面
          if (payload.kind === "pdf") {
            derivedBudget = await uploadPdfPageImages(file, payload.name ?? file.name, derivedBudget);
          }
        }
      } catch {
        setUploadError("网络中断，文件没有传上去");
      } finally {
        setUploadingCount((current) => Math.max(0, current - 1));
      }
    }
  }

  /** PDF 图纸页面 → 派生图片附件（走既有图片视觉通道）；返回剩余附件预算 */
  async function uploadPdfPageImages(pdfFile: File, pdfName: string, budget: number) {
    if (budget <= 0) return budget;
    try {
      const { pages, totalPages } = await renderPdfPagesToImages(pdfFile, {
        maxPages: Math.min(PDF_PAGE_RENDER_LIMIT, budget),
      });
      const baseName = pdfName.replace(/\.pdf$/i, "");
      for (const page of pages) {
        const pageName = `${baseName}-第${page.pageNumber}页.jpg`;
        const formData = new FormData();
        formData.append("file", new File([page.blob], pageName, { type: "image/jpeg" }));
        const response = await fetch("/api/upload/xiaochuan", { method: "POST", body: formData });
        const payload = await response.json().catch(() => null) as { url?: string; error?: string } | null;
        if (!response.ok || !payload?.url) {
          setUploadError(payload?.error || `图纸第 ${page.pageNumber} 页转图片上传失败`);
          break;
        }
        budget -= 1;
        setPendingAttachments((current) => [...current, {
          url: payload.url!,
          name: pageName,
          type: "image/jpeg",
          kind: "image",
          size: page.blob.size,
        }]);
      }
      if (totalPages > pages.length) {
        setUploadError(`图纸共 ${totalPages} 页，已自动识别前 ${pages.length} 页`);
      }
    } catch {
      setUploadError("PDF 页面转图片失败，这份 PDF 将只按文字方式识别");
    }
    return budget;
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    const sentAttachments = pendingAttachments;

    setInput("");
    setPendingAttachments([]);
    setUploadError("");
    setStreaming(true);
    const assistantIndex = messages.length + 1;
    setMessages((current) => [
      ...current,
      { role: "user", content: trimmed, attachments: sentAttachments },
      { role: "assistant", content: "", toolEvents: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    let conversationIdForTurn = activeId;

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationIdForTurn,
          message: trimmed,
          thinkingTier: tier,
          ...(sentAttachments.length > 0 ? { attachments: sentAttachments } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        // 按用户拍板：发送后待发附件一律清空（文件已传到服务器，需要时重新添加）
        setMessages((current) => current.map((item, index) => index === assistantIndex ? {
          ...item,
          content: payload?.error || "小川暂时联系不上，请稍后再试",
          error: true,
        } : item));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        if (!raw.startsWith("data:")) return;
        let event: {
          type?: string;
          conversationId?: string;
          text?: string;
          tool?: string;
          ok?: boolean;
          messageId?: string;
          message?: string;
        };
        try {
          event = JSON.parse(raw.slice(5).trim());
        } catch {
          return;
        }
        if (event.type === "meta" && event.conversationId) {
          const isNew = !conversationIdForTurn;
          conversationIdForTurn = event.conversationId;
          setActiveId(event.conversationId);
          if (isNew) void refreshConversations();
          return;
        }
        if (event.type === "reasoning" && event.text) {
          const reasoningText = event.text;
          setMessages((current) => current.map((item, index) => index === assistantIndex
            ? { ...item, reasoning: (item.reasoning ?? "") + reasoningText }
            : item));
          return;
        }
        if (event.type === "delta" && event.text) {
          setMessages((current) => current.map((item, index) => index === assistantIndex
            ? { ...item, content: item.content + event.text, reasoningFinished: true }
            : item));
          return;
        }
        if (event.type === "tool" && event.tool) {
          setMessages((current) => current.map((item, index) => index === assistantIndex
            ? { ...item, reasoningFinished: true, toolEvents: [...(item.toolEvents ?? []), { tool: event.tool!, ok: event.ok !== false }] }
            : item));
          return;
        }
        if (event.type === "done" && event.messageId) {
          setMessages((current) => current.map((item, index) => index === assistantIndex
            ? { ...item, id: event.messageId, reasoningFinished: true }
            : item));
          return;
        }
        if (event.type === "error") {
          setMessages((current) => current.map((item, index) => index === assistantIndex ? {
            ...item,
            content: item.content || event.message || "小川走神了一下，请重新提问试试",
            error: !item.content,
          } : item));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) handleEvent(line);
          newlineIndex = buffer.indexOf("\n");
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessages((current) => current.map((item, index) => index === assistantIndex ? {
          ...item,
          content: item.content || "网络中断了，请重新提问",
          error: !item.content,
        } : item));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      void refreshConversations();
    }
  }

  function retryLastAnswer() {
    if (streaming) return;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        void sendMessage(messages[index].content);
        return;
      }
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  const lastAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") return index;
    }
    return -1;
  })();

  return (
    <div className="relative flex h-dvh flex-col bg-[var(--app-bg)] text-[var(--text-primary)] print:hidden">
      {/* 顶部栏：独立站点自己的轻量头部 */}
      <header className={cn(
          "flex h-12 shrink-0 items-center gap-2 px-3 md:px-4",
          isEmpty
            ? "absolute inset-x-0 top-0 z-20 bg-transparent"
            : "border-b border-gray-100 bg-[var(--app-bg)] dark:border-zinc-800",
        )}>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? "收起对话记录" : "展开对话记录"}
          title={sidebarOpen ? "收起对话记录" : "展开对话记录"}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800"
        >
          <PanelLeft className="size-4" />
        </button>
        {/* 侧栏展开时标题区与侧栏顶部重叠，按拍板只在侧栏收起时展示 */}
        {!sidebarOpen && (
          <>
            <AgentAvatar expression={streaming ? "thinking" : "smile"} presence="online" alt="小川" className="size-7" />
            <div className="leading-tight">
              <h1 className="text-sm font-semibold">小川助手</h1>
              <p className="text-[10px] text-gray-400 dark:text-zinc-500">DachuanPro 内部 AI 助手</p>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ThemeControl compact />
          {isAgentAccount ? (
            // Agent 独立账号：没有平台可回，提供退出登录（CRM 员工保持原"返回平台"）
            <button
              type="button"
              onClick={async () => {
                try {
                  await fetch("/api/agent/account/logout", { method: "POST" });
                } catch {
                  // 忽略网络错误，本地状态仍会回到登录页
                }
                window.location.reload();
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <LogOut className="size-3.5" />
              退出
            </button>
          ) : (
            <a
              href={PLATFORM_HOME_URL}
              className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              返回平台
            </a>
          )}
          <UserAvatar
            avatarPath={userAvatarPath}
            email={viewer.email}
            name={viewer.name}
            userId={viewer.id}
            size="sm"
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
      {/* 左侧：历史会话 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white p-3 pt-14 transition-transform dark:border-zinc-800 dark:bg-zinc-950 md:static md:z-auto md:h-auto md:shrink-0 md:overflow-hidden md:transition-[width,transform] md:duration-300",
          // 首页时顶部栏是悬浮透明的，桌面侧栏要留出同高避免标题区叠在一起
          isEmpty ? "md:pt-14" : "md:pt-3",
          sidebarOpen
            ? "translate-x-0 md:w-64"
            : "-translate-x-full md:w-0 md:translate-x-0 md:border-r-0 md:p-0",
        )}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">对话记录</span>
          <button
            type="button"
            onClick={closeMobileDrawer}
            aria-label="关闭对话记录"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={startNewConversation}
          className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-[#ee7d2c] px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#d96f24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ee7d2c] focus-visible:ring-offset-2"
        >
          <MessageSquarePlus className="size-4" />
          开始新对话
        </button>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">还没有对话记录</p>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors",
                activeId === conversation.id
                  ? "bg-orange-50 dark:bg-orange-500/10"
                  : "hover:bg-gray-100 dark:hover:bg-zinc-800",
              )}
            >
              <button
                type="button"
                onClick={() => openConversation(conversation.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-xs font-medium text-gray-800 dark:text-zinc-200">{conversation.title}</span>
                <span className="block text-[10px] text-gray-400 dark:text-zinc-500">{relativeTime(conversation.updatedAt)}</span>
              </button>
              <button
                type="button"
                onClick={() => deleteConversation(conversation.id)}
                aria-label="删除对话"
                className="rounded p-1 text-gray-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 focus-visible:opacity-100 dark:text-zinc-600 dark:hover:bg-red-500/10"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 右侧：对话主区（视图切换由 GSAP 做过渡） */}
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-900">
        <div ref={viewRef} className="flex min-h-0 flex-1 flex-col">
        {isEmpty ? (
          /* ===== 新对话：深色驾驶舱 hero ===== */
          <div className="relative flex flex-1 flex-col overflow-hidden bg-gradient-to-br from-white via-orange-50/70 to-neutral-100 dark:from-[#0a0a0a] dark:via-[#050505] dark:to-[#0a0a0a]">
            <Spotlight className="-top-24 left-1/4" />
            <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
              {/* 左：标题 + 输入框 + 快捷提问 */}
              <div className="relative z-10 flex flex-col justify-center p-8 md:p-16 lg:p-24">
                <div className="max-w-xl">
                <h1 className="bg-gradient-to-b from-neutral-900 to-neutral-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl dark:from-neutral-50 dark:to-neutral-400">
                  What Can I Help You?
                </h1>
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                  你好，我是小川 —— DachuanPro 的专属 AI 智能体，关于平台的问题问我就行。
                </p>
                <div className="mt-6">
                  <XiaochuanInput
                    value={input}
                    onValueChange={setInput}
                    onSend={() => void sendMessage(input)}
                    onStop={stopStreaming}
                    streaming={streaming}
                    tier={tier}
                    onTierChange={setTier}
                    variant="hero"
                    onFilesSelected={(files) => void handleFilesSelected(files)}
                    pendingAttachments={pendingAttachments}
                    onRemoveAttachment={(index) => setPendingAttachments((current) => current.filter((_, i) => i !== index))}
                    uploadingCount={uploadingCount}
                    uploadError={uploadError}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void sendMessage(suggestion)}
                      className="rounded-full border border-gray-200 bg-white/80 px-3.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-[#ee7d2c]/60 hover:bg-[#ee7d2c]/10 hover:text-[#b3591a] dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-orange-200"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                </div>
              </div>
              {/* 右：Spline 3D 占位（待替换小川专属模型） */}
              <div className="relative h-64 md:h-full">
                <SplineScene className="h-full w-full" />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/70 to-transparent dark:from-[#050505]"
                />
              </div>
            </div>
          </div>
        ) : (
          /* ===== 对话中：消息流 ===== */
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
              <div className="mx-auto max-w-3xl space-y-4">
                {messages.map((item, index) => (
                  <div
                    key={item.id ?? `msg-${index}`}
                    className={cn("flex gap-2.5", item.role === "user" ? "justify-end" : "justify-start")}
                  >
                    {item.role === "assistant" && (
                      <AgentAvatar expression="smile" presence="online" alt="小川头像" className="mt-0.5 size-7 shrink-0" />
                    )}
                    <div className={cn("max-w-[85%] space-y-1", item.role === "user" && "flex flex-col items-end")}>
                      {item.role === "user" && (item.attachments?.length ?? 0) > 0 && (
                        <MessageAttachments attachments={item.attachments!} />
                      )}
                      {item.role === "assistant" && (item.toolEvents?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.toolEvents!.map((tool, toolIndex) => (
                            <span
                              key={`${tool.tool}-${toolIndex}`}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
                                tool.ok
                                  ? "bg-orange-50 text-[#b3591a] dark:bg-orange-500/10 dark:text-orange-300"
                                  : "bg-red-50 text-red-500 dark:bg-red-500/10",
                              )}
                            >
                              {tool.ok ? "已查" : "未查到"}·{toolDisplayName(tool.tool)}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.role === "assistant" && (item.reasoning ?? "").length > 0 && (
                        <ReasoningPanel
                          text={item.reasoning!}
                          active={streaming && !item.reasoningFinished && index === messages.length - 1}
                        />
                      )}
                      <div
                        className={cn(
                          "break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                          // 小川的正常回答走 Markdown 排版（不再需要 pre-wrap）；
                          // 用户消息与错误提示仍是纯文本，保留原样直出
                          (item.role === "user" || item.error) && "whitespace-pre-wrap",
                          item.role === "user"
                            ? "rounded-br-md bg-[#ee7d2c] text-white"
                            : item.error
                              ? "rounded-bl-md border border-red-100 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                              : "rounded-bl-md border border-gray-100 bg-white text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
                        )}
                      >
                        {item.role === "assistant" && !item.error && item.content ? (
                          <MarkdownContent content={item.content} />
                        ) : (
                          item.content || (item.role === "assistant" && streaming && index === messages.length - 1 ? (
                            <span className="inline-flex gap-1 py-1" aria-label="小川正在思考">
                              <span className="size-1.5 animate-bounce rounded-full bg-[#ee7d2c] [animation-delay:-0.3s]" />
                              <span className="size-1.5 animate-bounce rounded-full bg-[#ee7d2c] [animation-delay:-0.15s]" />
                              <span className="size-1.5 animate-bounce rounded-full bg-[#ee7d2c]" />
                            </span>
                          ) : "")
                        )}
                      </div>
                      {item.role === "assistant" && !streaming && item.content && (
                        <MessageActions
                          content={item.content}
                          canRetry={index === lastAssistantIndex && index > 0}
                          onRetry={retryLastAnswer}
                          messageId={item.id}
                          initialFeedback={item.feedback ?? null}
                        />
                      )}
                    </div>
                    {item.role === "user" && (
                      <div className="mt-0.5 shrink-0">
                        <UserAvatar
                          avatarPath={userAvatarPath}
                          email={viewer.email}
                          name={viewer.name}
                          userId={viewer.id}
                          size="sm"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <footer className="border-t border-gray-100 px-4 py-3 dark:border-zinc-800 md:px-6">
              <div className="mx-auto max-w-3xl">
                <XiaochuanInput
                  value={input}
                  onValueChange={setInput}
                  onSend={() => void sendMessage(input)}
                  onStop={stopStreaming}
                  streaming={streaming}
                  tier={tier}
                  onTierChange={setTier}
                  variant="bar"
                  onFilesSelected={(files) => void handleFilesSelected(files)}
                  pendingAttachments={pendingAttachments}
                  onRemoveAttachment={(index) => setPendingAttachments((current) => current.filter((_, i) => i !== index))}
                  uploadingCount={uploadingCount}
                  uploadError={uploadError}
                />
              </div>
            </footer>
          </>
        )}
        </div>
      </section>
      </div>
    </div>
  );
}
