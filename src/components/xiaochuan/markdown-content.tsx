"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * 小川回答的 Markdown 渲染层（2026-09 一期）：
 * 模型按习惯输出 Markdown（标题/列表/表格/代码块），此前聊天气泡按纯文本直出，
 * 用户看到的是原始星号井号；现在统一在这里渲染成排版。
 * 只用于小川（assistant）消息，用户消息保持纯文本；主聊天页与桌宠面板共用。
 * 样式跟随聊天气泡的浅/深色主题，色板与 XiaochuanChat 现有气泡一致。
 */

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-3 text-base font-semibold text-gray-900 first:mt-0 dark:text-zinc-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-[15px] font-semibold text-gray-900 first:mt-0 dark:text-zinc-50">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2.5 text-sm font-semibold text-gray-900 first:mt-0 dark:text-zinc-50">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2.5 text-sm font-semibold text-gray-900 first:mt-0 dark:text-zinc-50">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1 mt-2 text-[13px] font-semibold text-gray-900 first:mt-0 dark:text-zinc-50">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-[13px] font-semibold text-gray-500 first:mt-0 dark:text-zinc-400">{children}</h6>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-[#ee7d2c]/50 pl-2.5 text-gray-500 dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2.5 border-gray-100 dark:border-zinc-800" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[#b3591a] underline decoration-[#ee7d2c]/40 underline-offset-2 hover:decoration-[#ee7d2c] dark:text-orange-300"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-zinc-50">{children}</strong>,
  // 行内代码；代码块内的 code 由 pre 的 [&_code] 重置接管
  code: ({ children, className }) => (
    <code
      className={cn(
        "rounded bg-gray-100 px-1 py-0.5 font-mono text-[12px] text-[#b3591a] dark:bg-zinc-800 dark:text-orange-300",
        className,
      )}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl bg-zinc-950 p-3 text-xs leading-5 text-zinc-100 first:mt-0 last:mb-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50 dark:bg-zinc-800/70">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-gray-200 px-2 py-1 text-left font-medium text-gray-700 dark:border-zinc-700 dark:text-zinc-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-200 px-2 py-1 align-top dark:border-zinc-700">{children}</td>
  ),
};

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
