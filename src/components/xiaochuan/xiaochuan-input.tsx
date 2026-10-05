"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Loader2, Paperclip, SendHorizonal, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

export type ThinkingTier = "fast" | "standard" | "deep";

export type AttachmentView = {
  url: string;
  name: string;
  type: string;
  kind: "image" | "pdf" | "cad";
  size: number;
};

export const TIER_OPTIONS: Array<{ value: ThinkingTier; label: string; hint: string }> = [
  { value: "fast", label: "小川快跑", hint: "不假思索，秒问秒答" },
  { value: "standard", label: "陷入沉思", hint: "边查边想，日常首选" },
  { value: "deep", label: "牛来！", hint: "火力全开，深度分析" },
];

const TIER_ICONS: Record<ThinkingTier, string> = { fast: "⚡", standard: "🤔", deep: "🐂" };

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

const KIND_LABELS = { image: "图片", pdf: "PDF", cad: "CAD" } as const;

type XiaochuanInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  tier: ThinkingTier;
  onTierChange: (tier: ThinkingTier) => void;
  /** 深色 hero 内使用时为 true，输入框样式更醒目 */
  variant?: "hero" | "bar";
  /** 附件（段 2）：回形针选文件后由父组件上传，这里只负责展示与移除 */
  onFilesSelected?: (files: File[]) => void;
  pendingAttachments?: AttachmentView[];
  onRemoveAttachment?: (index: number) => void;
  uploadingCount?: number;
  uploadError?: string;
};

export function XiaochuanInput({
  value,
  onValueChange,
  onSend,
  onStop,
  streaming,
  tier,
  onTierChange,
  variant = "bar",
  onFilesSelected,
  pendingAttachments = [],
  onRemoveAttachment,
  uploadingCount = 0,
  uploadError,
}: XiaochuanInputProps) {
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const [clipHintVisible, setClipHintVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tierMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setTierMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [tierMenuOpen]);

  useEffect(() => {
    if (!clipHintVisible) return;
    const timer = setTimeout(() => setClipHintVisible(false), 2_000);
    return () => clearTimeout(timer);
  }, [clipHintVisible]);

  const currentTier = TIER_OPTIONS.find((option) => option.value === tier) ?? TIER_OPTIONS[1];
  const isHero = variant === "hero";
  const hasAttachmentArea = Boolean(onFilesSelected);
  const showPending = hasAttachmentArea && (pendingAttachments.length > 0 || uploadingCount > 0 || Boolean(uploadError));

  return (
    <div ref={containerRef} className="relative w-full">
      {/* 待发附件条（输入框上方） */}
      {showPending && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((attachment, index) => (
            <span
              key={`${attachment.url}-${index}`}
              className={cn(
                "group inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
                "border-gray-200 bg-white text-gray-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
              )}
            >
              {attachment.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={toProtectedUploadUrl(attachment.url)}
                  alt={attachment.name}
                  className="size-5 rounded object-cover"
                />
              ) : (
                <FileText className="size-3.5 shrink-0 text-[#ee7d2c]" />
              )}
              <span className="max-w-36 truncate">{attachment.name}</span>
              <span className="text-gray-400">{attachment.kind === "image" ? formatSize(attachment.size) : KIND_LABELS[attachment.kind]}</span>
              <button
                type="button"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() => onRemoveAttachment?.(index)}
                className="rounded p-0.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {uploadingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-400 dark:border-zinc-600">
              <Loader2 className="size-3.5 animate-spin" />
              正在上传 {uploadingCount} 个文件……
            </span>
          )}
          {uploadError && (
            <span className="inline-flex items-center rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-500 dark:bg-red-500/10 dark:text-red-300">
              {uploadError}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-2xl border p-2 shadow-sm transition-colors",
          isHero
            ? "border-gray-200 bg-white focus-within:border-[#ee7d2c] dark:border-white/15 dark:bg-white/[0.06] dark:focus-within:border-[#ee7d2c]/70"
            : "border-gray-200 bg-white focus-within:border-[#ee7d2c] dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-[#ee7d2c]/70",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.pdf,.dxf,.dwg"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) onFilesSelected?.(files);
          }}
        />
        <button
          type="button"
          aria-label="上传附件"
          title="上传图纸/图片/PDF（单文件 20MB 内；请勿上传涉密图纸与客户保密文件）"
          disabled={!hasAttachmentArea || uploadingCount > 0}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "rounded-lg p-2 transition-colors",
            "text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200",
          )}
        >
          <Paperclip className="size-4" />
        </button>
        <textarea
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder={isHero ? "Enter 发送 / Shift+Enter 换行" : "继续追问……"}
          aria-label="向小川提问"
          className={cn(
            "max-h-36 min-h-[40px] flex-1 resize-y bg-transparent py-2 text-sm outline-none",
            "text-gray-800 placeholder:text-gray-400 dark:text-white dark:placeholder:text-zinc-500",
          )}
        />
        {/* 思考程度选择（按拍板：不展示模型名称） */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setTierMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={tierMenuOpen}
            title={currentTier.hint}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors",
              "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20",
            )}
          >
            <span aria-hidden="true">{TIER_ICONS[tier]}</span>
            <span>{currentTier.label}</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
          {tierMenuOpen && (
            <div
              role="menu"
              aria-label="选择思考程度"
              className="absolute bottom-11 right-0 z-20 w-52 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            >
              {TIER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tier === option.value}
                  onClick={() => {
                    onTierChange(option.value);
                    setTierMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800",
                    tier === option.value && "bg-orange-50/70 dark:bg-orange-500/10",
                  )}
                >
                  <span aria-hidden="true" className="mt-0.5 text-sm">{TIER_ICONS[option.value]}</span>
                  <span>
                    <span className={cn(
                      "block text-xs font-medium",
                      tier === option.value ? "text-[#ee7d2c]" : "text-gray-800 dark:text-zinc-100",
                    )}>
                      {option.label}
                    </span>
                    <span className="block text-[10px] text-gray-400">{option.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="停止回答"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/10",
            )}
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!value.trim() || uploadingCount > 0}
            aria-label="发送"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ee7d2c] text-white shadow-sm transition-colors hover:bg-[#d96f24] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizonal className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
