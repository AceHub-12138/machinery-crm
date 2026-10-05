"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GlobalSearchDialog } from "./global-search-dialog";
import { ThemeControl } from "./theme-control";
import { UserMenu } from "./user-menu";
import { DesktopDownloadMenu } from "../desktop-download";

const ROUTE_LABELS: Record<string, string> = {
  admin: "平台管理",
  "after-sales": "售后调试",
  bom: "整机用料清单",
  change: "变更申请",
  cockpit: "管理员工作台",
  config: "配置中心",
  "contract-delete-requests": "合同删除审批",
  "contract-unlock-requests": "合同修改审批",
  contracts: "合同管理",
  crm: "CRM 工作台",
  customers: "客户管理",
  dashboard: "工作台",
  erp: "ERP",
  health: "系统健康",
  inventory: "库存台账",
  "kit-check-results": "齐套检查",
  materials: "物料管理",
  "master-data": "基础资料中心",
  "monthly-production-plans": "月度生产计划",
  monthly: "月任务",
  "operation-logs": "操作日志",
  "production-orders": "生产工单",
  products: "产品库",
  "production-order-change-requests": "生产工单变更审批",
  print: "打印",
  "purchase-demands": "采购需求",
  "purchase-orders": "采购订单",
  reminders: "跟进提醒",
  edit: "编辑",
  new: "新建",
  "new-optional": "新建选配项",
  settings: "系统设置",
  shipments: "发货管理",
  "spare-parts-forecast": "备件预测",
  "stock-check": "盘点",
  "stock-in": "入库",
  "stock-out": "出库",
  "stock-transfers": "库存调拨",
  "supplier-deliveries": "供应商交期跟踪",
  suppliers: "供应商管理",
  tasks: "我的工作",
  users: "用户与权限",
  warehouse: "仓库管理",
};

type TopbarProps = {
  onOpenMobileNavigation: () => void;
};

type InboxItem = {
  state?: { readAt?: string | null };
};

export function Topbar({ onOpenMobileNavigation }: TopbarProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    return segments.map((segment) => ({
      label:
        ROUTE_LABELS[segment] ||
        (/^[a-z0-9_-]{12,}$/i.test(segment) ? "详情" : segment),
    }));
  }, [pathname]);
  const pageTitle = breadcrumbs.at(-1)?.label || "工作台";

  useEffect(() => {
    const controller = new AbortController();

    async function loadInboxCount() {
      try {
        const response = await fetch("/api/system/tasks?view=inbox", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { items?: InboxItem[] };
        const items = Array.isArray(data.items) ? data.items : [];
        setUnreadCount(items.filter((item) => !item.state?.readAt).length);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setUnreadCount(0);
      }
    }

    void loadInboxCount();
    window.addEventListener("focus", loadInboxCount);
    return () => {
      controller.abort();
      window.removeEventListener("focus", loadInboxCount);
    };
  }, [pathname]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color:var(--surface)] px-4 py-3 backdrop-blur-xl print:hidden md:px-6 xl:px-8">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            aria-label="打开导航菜单"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)] md:hidden"
            onClick={onOpenMobileNavigation}
            type="button"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>

          <div className="min-w-0">
            <nav
              aria-label="面包屑"
              className="hidden items-center gap-1 text-xs text-[var(--text-tertiary)] sm:flex"
            >
              {breadcrumbs.slice(0, -1).map((item, index) => (
                <span className="flex min-w-0 items-center gap-1" key={`${item.label}-${index}`}>
                  <span className="max-w-28 truncate">{item.label}</span>
                  <ChevronRight aria-hidden="true" className="size-3" />
                </span>
              ))}
            </nav>
            <p className="truncate text-sm font-semibold text-[var(--text-primary)] sm:mt-0.5 sm:text-base">
              {pageTitle}
            </p>
          </div>
        </div>

        <div className="hidden min-w-48 max-w-md flex-[1.2] lg:block">
          <button
            aria-label="打开全局搜索"
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] px-3 text-[var(--text-tertiary)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:border-[var(--brand-orange)] focus-visible:outline-none"
            onClick={() => setSearchOpen(true)}
            type="button"
          >
            <Search aria-hidden="true" className="size-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left text-sm">搜索客户、合同、产品…(Ctrl+K)</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <DesktopDownloadMenu />
          <Link
            aria-label={`我的待办，${unreadCount} 条未读`}
            className="relative inline-flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
            href="/tasks"
          >
            <Bell aria-hidden="true" className="size-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full border-2 border-[var(--surface-solid)] bg-[var(--danger)] px-1 text-[10px] font-semibold leading-4 text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <ThemeControl compact />
          <UserMenu />
        </div>
      </div>
      </header>
      <GlobalSearchDialog
        key={searchOpen ? "search-open" : "search-closed"}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
    </>
  );
}
