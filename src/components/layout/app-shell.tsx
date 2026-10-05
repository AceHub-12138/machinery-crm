"use client";

import type { ReactNode } from "react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { FloatingSidebar } from "./floating-sidebar";
import { MobileNavigation } from "./mobile-navigation";
import { Topbar } from "./topbar";

const SIDEBAR_COLLAPSED_KEY = "dachuan.sidebar.collapsed";
const SIDEBAR_COLLAPSED_EVENT = "dachuan:sidebar-collapsed-change";
let volatileCollapsedState = false;

function subscribeToCollapsedState(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, onStoreChange);
  };
}

function getCollapsedSnapshot() {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    volatileCollapsedState = stored === "true";
    return volatileCollapsedState;
  } catch {
    return volatileCollapsedState;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsedState,
    getCollapsedSnapshot,
    () => false,
  );
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  function changeCollapsed(nextCollapsed: boolean) {
    volatileCollapsedState = nextCollapsed;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(nextCollapsed));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
  }

  const closeMobileNavigation = useCallback(
    () => setMobileNavigationOpen(false),
    [],
  );

  return (
    <div className="relative isolate min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] transition-colors print:bg-white print:text-black">
      <div
        aria-hidden="true"
        className="sidebar-backdrop-glow pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-[360px] md:block print:hidden"
      />
      <FloatingSidebar
        collapsed={collapsed}
        onCollapsedChange={changeCollapsed}
      />
      <MobileNavigation
        onClose={closeMobileNavigation}
        open={mobileNavigationOpen}
      />

      <div
        className={`relative z-10 min-h-screen transition-[padding] duration-200 print:pl-0 md:pl-[108px] ${
          collapsed ? "xl:pl-[108px]" : "xl:pl-[312px]"
        }`}
      >
        <Topbar onOpenMobileNavigation={() => setMobileNavigationOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] p-4 md:p-6 xl:p-8 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
