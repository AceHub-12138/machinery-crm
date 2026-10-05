"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
  type ThemeMode,
} from "@/lib/ui/theme";
import { cn } from "@/lib/utils";

const THEME_CHANGE_EVENT = "dachuan:theme-change";
const THEME_OPTIONS = [
  { label: "系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
];

type ThemeControlProps = {
  compact?: boolean;
  className?: string;
};

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

export function ThemeControl({ compact = false, className }: ThemeControlProps) {
  const mode = useSyncExternalStore<ThemeMode>(
    subscribeToTheme,
    getStoredTheme,
    () => "system" as ThemeMode,
  );

  useEffect(() => {
    applyTheme(mode);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };

    media.addEventListener("change", handleSystemChange);
    return () => {
      media.removeEventListener("change", handleSystemChange);
    };
  }, [mode]);

  function selectMode(nextMode: ThemeMode) {
    setStoredTheme(nextMode);
    applyTheme(nextMode);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  if (compact) {
    const resolved = resolveTheme(mode);
    const Icon = mode === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
    const nextMode: ThemeMode =
      mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    return (
      <button
        aria-label={`当前主题：${THEME_OPTIONS.find((item) => item.value === mode)?.label}，点击切换`}
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
          className,
        )}
        onClick={() => selectMode(nextMode)}
        type="button"
      >
        <Icon aria-hidden="true" className="size-[18px]" />
      </button>
    );
  }

  return (
    <div className={className}>
      <SegmentedControl
        onChange={(value) => selectMode(value as ThemeMode)}
        options={THEME_OPTIONS}
        value={mode}
      />
    </div>
  );
}
