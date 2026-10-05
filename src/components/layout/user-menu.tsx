"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ROLE_LABELS } from "@/lib/erp-roles";
import { ThemeControl } from "./theme-control";
import { UserAvatar } from "./user-avatar";

const AVATAR_UPDATED_EVENT = "dachuan:avatar-updated";

type ShellUser = {
  email?: string | null;
  id?: string;
  name?: string | null;
  role?: keyof typeof ROLE_LABELS;
  viewScope?: string;
};

function getDataScopeLabel(role?: string, viewScope?: string) {
  if (role === "PURCHASE" || role === "WAREHOUSE") return "不适用";
  if (role === "SUPER_ADMIN" || viewScope === "ALL") return "全区域";
  return "按负责省市";
}

export function UserMenu() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [menuState, setMenuState] = useState({ open: false, pathname });
  const menuRef = useRef<HTMLDivElement>(null);
  const [avatarPath, setAvatarPath] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const user = session?.user as ShellUser | undefined;
  const open = menuState.open && menuState.pathname === pathname;

  useEffect(() => {
    if (!user?.id) return;

    const controller = new AbortController();
    function handleAvatarUpdated(event: Event) {
      const nextAvatarPath = (
        event as CustomEvent<{ avatarPath?: string }>
      ).detail?.avatarPath;
      if (nextAvatarPath) setAvatarPath(nextAvatarPath);
    }

    fetch("/api/upload/avatar", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { avatarPath?: string }) =>
        setAvatarPath(data.avatarPath || ""),
      )
      .catch(() => undefined);

    window.addEventListener(AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    return () => {
      controller.abort();
      window.removeEventListener(AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const animationFrame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('a[href], button:not([disabled])')
        ?.focus();
    });

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuState({ open: false, pathname });
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuState({ open: false, pathname });
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = menuRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!menuRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, pathname]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="打开用户菜单"
        className="flex items-center gap-2 rounded-xl p-1 pr-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
        onClick={() => setMenuState({ open: !open, pathname })}
        type="button"
      >
        <UserAvatar
          avatarPath={avatarPath}
          email={user?.email}
          name={user?.name}
          size="md"
          userId={user?.id}
        />
        <span className="hidden max-w-24 truncate text-sm font-medium text-[var(--text-primary)] 2xl:block">
          {user?.name || user?.email || "用户"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`hidden size-4 transition-transform sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+12px)] z-[45] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-[var(--text-primary)] shadow-[var(--shadow-overlay)]"
          ref={menuRef}
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <UserAvatar
              avatarPath={avatarPath}
              email={user?.email}
              name={user?.name}
              size="lg"
              userId={user?.id}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {user?.name || "未设置展示名"}
              </p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">
                {user?.email || "未设置邮箱"}
              </p>
            </div>
          </div>

          <div className="mx-2 grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-muted)] p-3 text-xs">
            <div>
              <p className="text-[var(--text-tertiary)]">角色</p>
              <p className="mt-1 font-medium">
                {user?.role ? ROLE_LABELS[user.role] : "未识别"}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-tertiary)]">数据范围</p>
              <p className="mt-1 font-medium">
                {getDataScopeLabel(user?.role, user?.viewScope)}
              </p>
            </div>
          </div>

          <div className="my-2 border-t border-[var(--border)]" />
          <Link
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
            href="/settings"
            onClick={() => setMenuState({ open: false, pathname })}
          >
            <UserRound aria-hidden="true" className="size-4" />
            个人资料
          </Link>

          <div className="px-3 py-2.5">
            <p className="mb-2 text-xs text-[var(--text-tertiary)]">主题设置</p>
            <ThemeControl />
          </div>

          {user?.role === "SUPER_ADMIN" && (
            <Link
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
              href="/settings"
              onClick={() => setMenuState({ open: false, pathname })}
            >
              <Settings aria-hidden="true" className="size-4" />
              系统设置
            </Link>
          )}

          <div className="my-2 border-t border-[var(--border)]" />
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
            onClick={() => signOut({ callbackUrl: "/login" })}
            type="button"
          >
            <LogOut aria-hidden="true" className="size-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
