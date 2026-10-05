"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Bot,
  Bell,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  Crosshair,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Truck,
  UserCircle,
  Users,
  X,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { canViewERP, ROLE_LABELS } from "@/lib/erp-roles";
import { XIAOCHUAN_SITE_URL } from "@/lib/agent/site-url";

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

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    "/dashboard/crm": pathname.startsWith("/dashboard"),
    "/customers": pathname.startsWith("/customers") || pathname.startsWith("/leads") || pathname.startsWith("/contracts") || pathname.startsWith("/shipments") || pathname.startsWith("/after-sales") || pathname.startsWith("/reminders") || pathname.startsWith("/products"),
    "/erp/purchase-demands": pathname.startsWith("/erp/purchase") || pathname.startsWith("/erp/supplier"),
    "/erp/inventory": pathname.startsWith("/erp/inventory") || pathname.startsWith("/erp/stock") || pathname.startsWith("/erp/material") || pathname.startsWith("/erp/bom") || pathname.startsWith("/erp/warehouse"),
    "/erp/production-orders": pathname.startsWith("/erp/production") || pathname.startsWith("/erp/kit") || pathname.startsWith("/erp/monthly"),
  });

  const userRole = (session?.user as any)?.role;
  const userViewScope = (session?.user as any)?.viewScope;
  const canViewErpModule = canViewERP(userRole || "");
  const filteredNavItems = navItems.filter((item) => {
    if (item.roles && !item.roles.includes(userRole)) return false;
    if (userRole === "WAREHOUSE" || userRole === "PURCHASE") return item.erpOnly === true || item.href === "/dashboard/crm" || item.href === "/xiaochuan";
    if (item.adminOnly && userRole !== "SUPER_ADMIN") return false;
    if (item.erpOnly && !canViewErpModule) return false;
    return true;
  });

  useEffect(() => {
    const nav = navRef.current; if (!nav) return;
    const saved = sessionStorage.getItem("dachuan.sidebar.scroll");
    if (saved) nav.scrollTop = Number(saved) || 0;
  }, [pathname]);

  const rememberScroll = () => {
    if (navRef.current) sessionStorage.setItem("dachuan.sidebar.scroll", String(navRef.current.scrollTop));
  };

  const NavContent = () => (
    <>
      <div className="px-4 py-4 border-b border-gray-100">
        <img src="/logo.png" alt="大川机械" className="w-40 h-auto object-contain" />
      </div>

      <nav ref={navRef} onScroll={rememberScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-1">
        {filteredNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          if (item.children) {
            const visibleChildren = item.children.filter((child) =>
              (!child.adminOnly || userRole === "SUPER_ADMIN") && (!child.roles || child.roles.includes(userRole))
            );
            const groupOpen = openGroups[item.href] ?? false;
            return (
              <div key={item.href}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((open) => ({ ...open, [item.href]: !groupOpen }))}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", groupOpen && "rotate-180")} />
                </button>
                {groupOpen && (
                  <div className="ml-7 mt-1 space-y-1">
                    {visibleChildren.map((child) => {
                      const childActive = pathname === child.href || Boolean(child.children?.some((nested) => pathname === nested.href));
                      if (child.children) {
                        const nestedOpen = openGroups[child.href] ?? childActive;
                        const visibleNested = child.children.filter((nested) => (!nested.adminOnly || userRole === "SUPER_ADMIN") && (!nested.roles || nested.roles.includes(userRole)));
                        return <div key={child.href}>
                          <button type="button" onClick={() => setOpenGroups((open) => ({ ...open, [child.href]: !nestedOpen }))} className={cn("flex w-full items-center rounded-lg px-3 py-2 text-xs font-medium transition-colors", childActive ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900")}>
                            <span className="flex-1 text-left">{child.label}</span><ChevronDown className={cn("h-3.5 w-3.5 transition-transform", nestedOpen && "rotate-180")} />
                          </button>
                          {nestedOpen && <div className="ml-3 mt-1 space-y-1 border-l border-gray-200 pl-2">{visibleNested.map((nested) => <Link key={nested.href} href={nested.href} onClick={() => setMobileOpen(false)} className={cn("block rounded-lg px-3 py-2 text-xs transition-colors", pathname === nested.href ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900")}>{nested.label}</Link>)}</div>}
                        </div>;
                      }
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => { rememberScroll(); setMobileOpen(false); }}
                          className={cn(
                            "block px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                            childActive ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.external ? XIAOCHUAN_SITE_URL : item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noreferrer" : undefined}
              onClick={() => { rememberScroll(); setMobileOpen(false); }}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="w-4 h-4" />
              {item.label}
              {item.external && <ArrowUpRight className="ml-auto size-3.5 opacity-50" />}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
        <div className="mb-3 text-xs text-gray-500">
          <p className="font-medium text-gray-700">{session?.user?.name || session?.user?.email}</p>
          <p>{ROLE_LABELS[userRole as keyof typeof ROLE_LABELS] || (userViewScope === "ALL" ? "全区域" : "销售")}</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
        >
          <LogOut className="w-4 h-4" />
          退出登录
        </button>
      </div>
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-white border border-gray-200 rounded-lg shadow-sm"
      >
        <Menu className="w-5 h-5" />
      </button>

      <aside className="hidden lg:flex fixed inset-y-0 left-0 h-dvh max-h-dvh w-64 overflow-hidden bg-white border-r border-gray-200 flex-col">
        <NavContent />
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 h-dvh max-h-dvh w-64 overflow-hidden bg-white border-r border-gray-200 flex flex-col">
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute top-3 right-3 p-2 text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
            <NavContent />
          </aside>
        </div>
      )}
    </>
  );
}
