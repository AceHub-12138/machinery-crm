"use client";

import { Download, HardDriveDownload, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type DesktopLatest = {
  available: true;
  version: string;
  fileName: string;
  file: string;
  releaseDate: string | null;
  size: number | null;
};

/** 读当前服务器上发布的桌面客户端版本（公开端点，未登录可用） */
export function useDesktopLatest() {
  const [latest, setLatest] = useState<DesktopLatest | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    fetch("/api/desktop/latest", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return Promise.reject(new Error(String(response.status)));
        const data = (await response.json()) as DesktopLatest;
        setLatest(data);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return { latest, state };
}

function formatBytes(size?: number | null) {
  if (!size && size !== 0) return null;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(0)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}

/** 下载面板正文：顶栏弹层与设置页卡片共用 */
export function DesktopDownloadPanel() {
  const { latest, state } = useDesktopLatest();

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 px-1 py-2 text-sm text-[var(--text-tertiary)]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        正在获取版本信息…
      </p>
    );
  }

  if (state === "unavailable" || !latest) {
    return (
      <p className="px-1 py-2 text-sm text-[var(--text-tertiary)]">暂未发布桌面客户端安装包。</p>
    );
  }

  const sizeLabel = formatBytes(latest.size);

  return (
    <div>
      <div className="flex items-center gap-2">
        <HardDriveDownload aria-hidden="true" className="size-4 text-[var(--brand-orange)]" />
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          大川Pro工作台 v{latest.version}
        </p>
      </div>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">
        Windows 64 位{sizeLabel ? ` · 安装包约 ${sizeLabel}` : ""}
      </p>
      <a
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-orange)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
        download
        href={latest.file}
      >
        <Download aria-hidden="true" className="size-4" />
        下载安装包
      </a>
      <p className="mt-2.5 text-xs leading-5 text-[var(--text-tertiary)]">
        下载后运行安装即可。安装一次后，后续新版本会在桌面端内提示并直接更新，无需重新下载安装包。
      </p>
    </div>
  );
}

/** 顶栏入口：下载图标 + 弹层（结构与 UserMenu 同款） */
export function DesktopDownloadMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="下载桌面客户端"
        className={`inline-flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)] ${open ? "text-[var(--text-primary)]" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <HardDriveDownload aria-hidden="true" className="size-[18px]" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+12px)] z-[45] w-[min(300px,calc(100vw-24px))] rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-overlay)]">
          <DesktopDownloadPanel />
        </div>
      )}
    </div>
  );
}

/** 登录页入口：未登录也能看到并下载；服务器未发布安装包时整个隐藏 */
export function DesktopDownloadLink() {
  const { latest, state } = useDesktopLatest();
  if (state !== "ready" || !latest) return null;

  return (
    <a
      className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--brand-orange)]"
      download
      href={latest.file}
    >
      <Download aria-hidden="true" className="size-3.5" />
      下载 Windows 桌面客户端 v{latest.version}
    </a>
  );
}
