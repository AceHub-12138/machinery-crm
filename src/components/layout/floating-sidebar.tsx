"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowUpRight,
  Bot,
  Bell,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Crosshair,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { DISPLAY_VERSION } from "@/lib/changelog";
import { canViewERP } from "@/lib/erp-roles";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";
import { cn } from "@/lib/utils";
import { XIAOCHUAN_SITE_URL } from "@/lib/agent/site-url";

gsap.registerPlugin(useGSAP);

type NavChild = {
  href: string;
  label: string;
  adminOnly?: boolean;
  erpOnly?: boolean;
  roles?: string[];
  /** 外部跳转入口（如小川独立站）：新窗口打开，不参与当前页高亮 */
  external?: boolean;
  children?: NavChild[];
};

type NavItem = NavChild & {
  icon: LucideIcon;
  children?: NavChild[];
};

const navItems: NavItem[] = [
  { href: "/dashboard/crm", label: "工作台", icon: LayoutDashboard, children: [
    { href: "/dashboard/crm", label: "CRM工作台", roles: ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"] },
    { href: "/dashboard/erp", label: "ERP工作台", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] },
  ] },
  { href: "/xiaochuan", label: "小川助手", icon: Bot, external: true },
  { href: "/lead-hunter", label: "获客助手", icon: Crosshair, adminOnly: true },
  { href: "/tasks", label: "我的工作", icon: Bell },
  { href: "/customers", label: "客户与销售", icon: Users, roles: ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"], children: [
    { href: "/customers", label: "客户管理" }, { href: "/leads", label: "AI 线索池" }, { href: "/reminders", label: "跟进提醒" }, { href: "/contracts", label: "合同管理" }, { href: "/shipments", label: "发货管理" }, { href: "/after-sales", label: "售后调试" }, { href: "/products", label: "产品库" },
  ] },
  { href: "/erp/purchase-demands", label: "采购与供应", icon: FileText, erpOnly: true, children: [
    { href: "/erp/purchase-demands", label: "采购需求", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] }, { href: "/erp/purchase-orders", label: "采购订单", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] }, { href: "/erp/suppliers", label: "供应商管理", roles: ["SUPER_ADMIN", "PURCHASE"] }, { href: "/erp/supplier-deliveries", label: "供应商交期跟踪", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] },
  ] },
  { href: "/erp/inventory", label: "库存与物料", icon: Boxes, erpOnly: true, children: [
    { href: "/erp/inventory", label: "库存台账", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] }, { href: "/erp/stock-in", label: "入库", roles: ["SUPER_ADMIN", "WAREHOUSE"] }, { href: "/erp/stock-out", label: "出库", roles: ["SUPER_ADMIN", "WAREHOUSE"] }, { href: "/erp/stock-transfers", label: "库存调拨", roles: ["SUPER_ADMIN", "WAREHOUSE"] }, { href: "/erp/stock-check", label: "盘点", roles: ["SUPER_ADMIN", "WAREHOUSE"] }, { href: "/erp/materials", label: "物料管理", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] }, { href: "/erp/bom", label: "整机用料清单", roles: ["SUPER_ADMIN", "WAREHOUSE"] }, { href: "/erp/warehouse", label: "仓库管理", roles: ["SUPER_ADMIN", "WAREHOUSE"] },
  ] },
  { href: "/erp/production-orders", label: "生产执行", icon: ClipboardCheck, erpOnly: true, children: [
    { href: "/erp/production-orders", label: "生产工单", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] }, { href: "/erp/kit-check-results", label: "齐套检查", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] }, { href: "/erp/monthly-production-plans", label: "月度生产计划", roles: ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] },
  ] },
  { href: "/admin/cockpit", label: "平台管理", icon: Settings, adminOnly: true, children: [
    { href: "/admin/cockpit", label: "管理员工作台" }, { href: "/admin/master-data", label: "基础资料中心" }, { href: "/users", label: "用户与权限" }, { href: "/admin/config", label: "配置中心" }, { href: "/admin/agent", label: "Agent 管理" }, { href: "/operation-logs", label: "操作日志" }, { href: "/admin/health", label: "系统健康" },
  ] },
];

type FloatingSidebarProps = {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavigate?: () => void;
  variant?: "desktop" | "drawer";
};

type HealthState = "checking" | "healthy" | "unavailable";
type SidebarTransitionPhase = "collapsing" | "expanding" | "revealing" | null;

function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function hasActiveChild(pathname: string, children?: NavChild[]): boolean {
  return Boolean(
    children?.some(
      (child) =>
        isRouteActive(pathname, child.href) ||
        hasActiveChild(pathname, child.children),
    ),
  );
}

function initialOpenGroups(pathname: string) {
  return {
    "/dashboard/crm": pathname.startsWith("/dashboard"),
    "/customers": pathname.startsWith("/customers") || pathname.startsWith("/leads") || pathname.startsWith("/contracts") || pathname.startsWith("/shipments") || pathname.startsWith("/after-sales") || pathname.startsWith("/reminders") || pathname.startsWith("/products"),
    "/erp/purchase-demands": pathname.startsWith("/erp/purchase") || pathname.startsWith("/erp/supplier"),
    "/erp/inventory": pathname.startsWith("/erp/inventory") || pathname.startsWith("/erp/stock") || pathname.startsWith("/erp/material") || pathname.startsWith("/erp/bom") || pathname.startsWith("/erp/warehouse"),
    "/erp/production-orders": pathname.startsWith("/erp/production") || pathname.startsWith("/erp/kit") || pathname.startsWith("/erp/monthly"),
  };
}

export function FloatingSidebar({
  collapsed = false,
  onCollapsedChange,
  onNavigate,
  variant = "desktop",
}: FloatingSidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const asideRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const onCollapsedChangeRef = useRef(onCollapsedChange);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    initialOpenGroups(pathname),
  );
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [transitionPhase, setTransitionPhase] =
    useState<SidebarTransitionPhase>(null);
  const reducedMotion = useReducedMotion();
  const userRole = session?.user?.role || "";
  const canViewErpModule = canViewERP(userRole || "");
  const filteredNavItems = navItems.filter((item) => {
    if (item.roles && !item.roles.includes(userRole)) return false;
    if (userRole === "WAREHOUSE" || userRole === "PURCHASE") return item.erpOnly === true || item.href === "/dashboard/crm" || item.href === "/xiaochuan";
    if (item.adminOnly && userRole !== "SUPER_ADMIN") return false;
    if (item.erpOnly && !canViewErpModule) return false;
    return true;
  });
  const isDrawer = variant === "drawer";
  const hideExpandedLabels =
    transitionPhase === "expanding" || transitionPhase === "revealing";

  useEffect(() => {
    onCollapsedChangeRef.current = onCollapsedChange;
  }, [onCollapsedChange]);

  useGSAP(
    () => {
      const aside = asideRef.current;
      if (!aside || !transitionPhase || transitionPhase === "expanding") return;
      const labels = Array.from(
        aside.querySelectorAll<HTMLElement>("[data-sidebar-label]"),
      );

      if (isDrawer || reducedMotion || isReducedMotionPreferred()) {
        gsap.set(labels, { clearProps: "opacity,transform" });
        if (transitionPhase === "collapsing") {
          onCollapsedChangeRef.current?.(true);
        }
        setTransitionPhase(null);
        return;
      }

      if (transitionPhase === "collapsing") {
        if (labels.length === 0) {
          onCollapsedChangeRef.current?.(true);
          setTransitionPhase(null);
          return;
        }
        gsap.to(labels, {
          duration: MOTION_DURATION.fast,
          ease: MOTION_EASE.exit,
          opacity: 0,
          onComplete: () => {
            onCollapsedChangeRef.current?.(true);
            setTransitionPhase(null);
          },
        });
        return;
      }

      gsap.fromTo(
        labels,
        { opacity: 0 },
        {
          duration: MOTION_DURATION.normal,
          ease: MOTION_EASE.enter,
          opacity: 1,
          onComplete: () => setTransitionPhase(null),
        },
      );
    },
    {
      dependencies: [isDrawer, reducedMotion, transitionPhase],
      revertOnUpdate: true,
      scope: asideRef,
    },
  );

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const saved = sessionStorage.getItem("dachuan.sidebar.scroll");
    if (saved) nav.scrollTop = Number(saved) || 0;
  }, [pathname]);

  useEffect(() => {
    if (!userRole) return;
    if (userRole !== "SUPER_ADMIN") return;

    const controller = new AbortController();
    fetch("/api/system/health", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { items?: Array<{ name: string; status: string }> }) => {
        const webApp = data.items?.find((item) => item.name === "Web 应用");
        setHealthState(webApp?.status === "OK" ? "healthy" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setHealthState("unavailable");
      });
    return () => controller.abort();
  }, [userRole]);

  const visibleHealthState =
    userRole === "SUPER_ADMIN" ? healthState : "unavailable";

  function rememberScroll() {
    if (navRef.current) {
      sessionStorage.setItem(
        "dachuan.sidebar.scroll",
        String(navRef.current.scrollTop),
      );
    }
  }

  function navigate() {
    rememberScroll();
    onNavigate?.();
  }

  function requestCollapsedChange(nextCollapsed: boolean) {
    const canSequenceDesktop =
      !isDrawer &&
      !reducedMotion &&
      !isReducedMotionPreferred() &&
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches;

    if (!canSequenceDesktop) {
      onCollapsedChangeRef.current?.(nextCollapsed);
      return;
    }

    if (nextCollapsed) {
      setTransitionPhase("collapsing");
      return;
    }

    setTransitionPhase("expanding");
    onCollapsedChangeRef.current?.(false);
  }

  function handleWidthTransitionEnd(event: React.TransitionEvent<HTMLElement>) {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== "width" ||
      transitionPhase !== "expanding" ||
      collapsed
    ) {
      return;
    }
    setTransitionPhase("revealing");
  }

  function compactItem(item: NavItem) {
    const active =
      isRouteActive(pathname, item.href) || hasActiveChild(pathname, item.children);
    const Icon = item.icon;
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex size-11 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
          active
            ? "bg-[var(--brand-orange-soft)] text-[var(--brand-orange-hover)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        )}
        href={item.external ? XIAOCHUAN_SITE_URL : item.href}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noreferrer" : undefined}
        key={`compact-${item.href}`}
        onClick={navigate}
        title={item.label}
      >
        <Icon aria-hidden="true" className="size-[18px]" />
        <span className="sr-only">{item.label}</span>
      </Link>
    );
  }

  function fullItem(item: NavItem) {
    const active =
      isRouteActive(pathname, item.href) || hasActiveChild(pathname, item.children);
    const Icon = item.icon;

    if (!item.children) {
      return (
        <Link
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
            active
              ? "bg-[var(--brand-orange-soft)] text-[var(--brand-orange-hover)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
          )}
          href={item.external ? XIAOCHUAN_SITE_URL : item.href}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noreferrer" : undefined}
          key={item.href}
          onClick={navigate}
        >
          <Icon aria-hidden="true" className="size-[18px] shrink-0" />
          <span
            className={cn(hideExpandedLabels && "opacity-0")}
            data-sidebar-label
          >
            {item.label}
          </span>
          {item.external && (
            <ArrowUpRight
              aria-hidden="true"
              className={cn("ml-auto size-3.5 opacity-50", hideExpandedLabels && "hidden")}
            />
          )}
        </Link>
      );
    }

    const visibleChildren = item.children.filter(
      (child) =>
        (!child.adminOnly || userRole === "SUPER_ADMIN") &&
        (!child.roles || child.roles.includes(userRole)),
    );
    const groupOpen = openGroups[item.href] ?? false;
    return (
      <div key={item.href}>
        <button
          aria-expanded={groupOpen}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
            active
              ? "bg-[var(--brand-orange-soft)] text-[var(--brand-orange-hover)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
          )}
          onClick={() =>
            setOpenGroups((groups) => ({ ...groups, [item.href]: !groupOpen }))
          }
          type="button"
        >
          <Icon aria-hidden="true" className="size-[18px] shrink-0" />
          <span
            className={cn("flex-1 text-left", hideExpandedLabels && "opacity-0")}
            data-sidebar-label
          >
            {item.label}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform", groupOpen && "rotate-180")}
            data-sidebar-label
          />
        </button>
        {groupOpen && (
          <div
            className={cn(
              "ml-5 mt-1 space-y-0.5 border-l border-[var(--border)] pl-3",
              hideExpandedLabels && "opacity-0",
            )}
            data-sidebar-label
          >
            {visibleChildren.map((child) => {
              const childActive =
                isRouteActive(pathname, child.href) ||
                hasActiveChild(pathname, child.children);
              return (
                <Link
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-9 items-center rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
                    childActive
                      ? "bg-[var(--brand-orange-soft)] text-[var(--brand-orange-hover)]"
                      : "text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                  )}
                  href={child.href}
                  key={child.href}
                  onClick={navigate}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -left-[17px] h-4 w-1 rounded-full",
                      childActive ? "bg-[var(--brand-orange)]" : "bg-transparent",
                    )}
                  />
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const statusText =
    visibleHealthState === "healthy"
      ? "Web 应用运行正常"
      : visibleHealthState === "checking"
        ? "正在读取系统健康信息"
        : userRole === "SUPER_ADMIN"
          ? "系统健康信息不可用"
          : "系统健康信息仅管理员可见";

  return (
    <aside
      aria-label={isDrawer ? "移动端主导航" : "主导航"}
      className={cn(
        "sidebar-glass overflow-hidden border print:hidden",
        isDrawer
          ? "flex h-full w-[min(86vw,320px)] flex-col rounded-r-[var(--radius-2xl)]"
          : "fixed bottom-4 left-4 top-4 z-30 hidden flex-col rounded-[var(--radius-2xl)] transition-[width] duration-200 motion-reduce:transition-none md:flex",
        !isDrawer && (collapsed ? "w-[76px]" : "w-[76px] xl:w-[264px]"),
      )}
      onTransitionEnd={handleWidthTransitionEnd}
      ref={asideRef}
    >
      <div className="sidebar-glass-section flex h-[72px] shrink-0 items-center justify-center border-b border-[var(--border)] px-3">
        {(isDrawer || !collapsed) && (
          <Image
            alt="大川机械"
            className={cn(
              "h-auto w-40",
              !isDrawer && "hidden xl:block",
              hideExpandedLabels && "opacity-0",
            )}
            data-sidebar-label
            height={40}
            priority
            src="/logo.png"
            width={160}
          />
        )}
        {!isDrawer && (
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-xl bg-[var(--brand-orange)] text-lg font-bold text-white",
              !collapsed && "xl:hidden",
            )}
          >
            川
          </span>
        )}
      </div>

      <nav
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain bg-transparent p-3"
        onScroll={rememberScroll}
        ref={navRef}
      >
        {filteredNavItems.map((item) => {
          if (isDrawer) return fullItem(item);
          if (collapsed) return compactItem(item);
          return (
            <div key={item.href}>
              <div className="xl:hidden">{compactItem(item)}</div>
              <div className="hidden xl:block">{fullItem(item)}</div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-glass-section shrink-0 border-t border-[var(--border)] p-3">
        <div
          className={cn(
            "sidebar-glass-panel flex items-center rounded-xl",
            isDrawer || !collapsed ? "justify-between gap-2 px-3 py-2" : "justify-center py-2",
          )}
          title={statusText}
        >
          {(isDrawer || !collapsed) && (
            <div
              className={cn(
                "min-w-0",
                !isDrawer && "hidden xl:block",
                hideExpandedLabels && "opacity-0",
              )}
              data-sidebar-label
            >
              <p className="truncate text-[10px] text-[var(--text-tertiary)]">{DISPLAY_VERSION}</p>
            </div>
          )}
          <span
            aria-label={statusText}
            className={cn(
              "size-2.5 shrink-0 rounded-full ring-4",
              visibleHealthState === "healthy"
                ? "bg-[var(--success)] ring-green-500/10"
                : visibleHealthState === "checking"
                  ? "bg-[var(--warning)] ring-amber-500/10"
                  : "bg-[var(--neutral)] ring-slate-500/10",
            )}
            role="status"
          />
        </div>

        {!isDrawer && (
          <button
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
            onClick={() => requestCollapsedChange(!collapsed)}
            type="button"
          >
            {collapsed ? (
              <ChevronRight aria-hidden="true" className="size-4" />
            ) : (
              <ChevronLeft aria-hidden="true" className="size-4" />
            )}
            {!collapsed && (
              <span
                className={cn("hidden xl:inline", hideExpandedLabels && "opacity-0")}
                data-sidebar-label
              >
                折叠侧栏
              </span>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}
