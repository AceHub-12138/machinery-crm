"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Factory,
  History,
  PackageCheck,
  PackageX,
  RefreshCw,
  ShoppingCart,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { StaggerContainer } from "@/components/motion/StaggerContainer";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { MetricCard } from "@/components/ui/metric-card";
import { SurfaceCard } from "@/components/ui/surface-card";
import { MOTION_SEQUENCE } from "@/lib/motion/config";

function number(value: unknown) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function animatedNumber(value: unknown) {
  return Number(value || 0);
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无更新时间";
}

function formatShortTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
}

const roleViewMeta = {
  ADMIN: {
    title: "全局视图",
    description: "以库存为主视图，集中查看库存健康与生产、采购风险。",
    icon: Factory,
  },
  PURCHASE: {
    title: "采购视图",
    description: "聚焦库存预警、采购需求与供应交付风险。",
    icon: ShoppingCart,
  },
  WAREHOUSE: {
    title: "仓库视图",
    description: "聚焦各仓库库存健康、收发执行与异常提醒。",
    icon: Warehouse,
  },
} as const;

const quickActions = {
  ADMIN: [
    { label: "库存台账", description: "查看全部仓库库存", href: "/erp/inventory", icon: Boxes },
    { label: "入库", description: "处理到货与入库", href: "/erp/stock-in", icon: PackageCheck },
    { label: "出库", description: "处理领料与出库", href: "/erp/stock-out", icon: ClipboardCheck },
    { label: "物料管理", description: "维护物料与预警线", href: "/erp/materials", icon: ClipboardList },
  ],
  PURCHASE: [
    { label: "采购订单", description: "查看订单执行状态", href: "/erp/purchase-orders", icon: ClipboardList },
    { label: "供应商管理", description: "查看采购供应商", href: "/erp/suppliers", icon: ShoppingCart },
    { label: "库存预警", description: "查看低库存物料", href: "/erp/inventory?alertOnly=1", icon: Boxes },
    { label: "生产工单", description: "查看生产缺料来源", href: "/erp/production-orders", icon: ClipboardCheck },
  ],
  WAREHOUSE: [
    { label: "库存台账", description: "查看仓库当前库存", href: "/erp/inventory", icon: Boxes },
    { label: "采购入库", description: "处理到货与入库", href: "/erp/stock-in", icon: PackageCheck },
    { label: "生产出库", description: "处理领料与出库", href: "/erp/stock-out", icon: ClipboardCheck },
    { label: "库存调拨", description: "查看仓间调拨", href: "/erp/stock-transfers", icon: Warehouse },
  ],
} as const;

const movementMeta: Record<string, { label: string; className: string }> = {
  STOCK_IN: { label: "入库", className: "bg-green-100 text-green-700" },
  STOCK_OUT: { label: "出库", className: "bg-red-100 text-red-700" },
  CHECK_ADJUST: { label: "盘点调整", className: "bg-gray-100 text-gray-600" },
  TRANSFER_IN: { label: "调拨入库", className: "bg-blue-100 text-blue-700" },
  TRANSFER_OUT: { label: "调拨出库", className: "bg-blue-100 text-blue-700" },
};

function DashboardSection({
  title,
  description,
  error,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  error?: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <SurfaceCard className="p-5" variant="dashboard">
      <div>
        <h2 className="font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">{description}</p>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={onRetry} title={`${title}暂时不可用`} />
      ) : (
        <div className="mt-5">{children}</div>
      )}
    </SurfaceCard>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--text-tertiary)]">
      {children}
    </div>
  );
}

export default function ErpDashboardPage() {
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [showErpExtras, setShowErpExtras] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/erp/dashboard", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "ERP工作台加载失败");
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ERP工作台加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <PageContainer className="dashboard-atmosphere space-y-6" variant="dashboard">
        <SurfaceCard className="p-6" variant="dashboard"><LoadingSkeleton lines={4} /></SurfaceCard>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <MetricCard key={index} loading surface="dashboard" title="正在加载" />)}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <SurfaceCard className="p-6" variant="dashboard"><LoadingSkeleton lines={6} /></SurfaceCard>
          <SurfaceCard className="p-6" variant="dashboard"><LoadingSkeleton lines={6} /></SurfaceCard>
        </div>
      </PageContainer>
    );
  }

  if (error && !data) {
    return (
      <PageContainer className="dashboard-atmosphere" variant="dashboard">
        <SurfaceCard className="p-1" variant="dashboard">
          <ErrorState message={error} onRetry={() => void load()} title="ERP 工作台暂时无法加载" />
        </SurfaceCard>
      </PageContainer>
    );
  }

  const roleView = (data?.roleView || "WAREHOUSE") as keyof typeof roleViewMeta;
  const view = roleViewMeta[roleView];
  const ViewIcon = view.icon;
  const production = data?.production?.data;
  const kit = data?.kitCheck?.data;
  const procurement = data?.procurement?.data;
  const inventory = data?.inventory?.data;
  const movements = data?.movements?.data;
  const alerts = data?.alerts?.data;

  const warehouses = (inventory?.warehouses || []) as Array<{ id: string; name: string; code: string; kinds: number; alertCount: number; value?: number }>;
  const filteredWarehouses = warehouses.filter((warehouse) => {
    const keyword = warehouseFilter.trim().toLowerCase();
    if (!keyword) return true;
    return warehouse.name.toLowerCase().includes(keyword) || warehouse.code.toLowerCase().includes(keyword);
  });
  const alertList = (inventory?.alerts || []) as Array<{ materialId: string; code: string; name: string; unit: string; warehouseId: string; warehouse: string; quantity: number; threshold: number; gap: number }>;
  const movementItems = (movements?.items || []) as Array<{ id: string; type: string; quantity: number; unit: string; materialName: string; materialCode: string; warehouse: string; createdAt: string }>;
  const hasProductionData = Boolean(production && Object.values(production.statusDistribution || {}).some((count) => Number(count) > 0));
  const hasProcurementData = Boolean(procurement && (procurement.pendingDemands > 0 || procurement.delayedItems > 0 || (procurement.orders || []).length > 0));

  const amountVisible = inventory?.inventoryValue !== undefined;

  return (
    <PageContainer className="dashboard-atmosphere space-y-6" variant="dashboard">
      <SurfaceCard className="p-6" variant="dashboard">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]">
              <ViewIcon className="size-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--brand-orange)]">ERP · {view.title}</p>
              <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">ERP 工作台</h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{view.description}</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">更新于 {formatDateTime(data?.generatedAt)}</p>
            </div>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)] disabled:cursor-wait disabled:opacity-60"
            disabled={loading}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            刷新数据
          </button>
        </div>
      </SurfaceCard>

      <StaggerContainer className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" delay={MOTION_SEQUENCE.kpi}>
        <MetricCard
          animateNumber
          error={data?.inventory?.error}
          href="/erp/inventory?alertOnly=1"
          icon={<AlertTriangle className="size-6" />}
          number={animatedNumber(inventory?.alertCount)}
          surface="dashboard"
          title="库存报警"
        />
        <MetricCard
          animateNumber
          error={data?.inventory?.error}
          href="/erp/inventory?zeroStock=1"
          icon={<PackageX className="size-6" />}
          number={animatedNumber(inventory?.zeroCount)}
          surface="dashboard"
          title="零库存物料"
        />
        <MetricCard
          animateNumber
          error={data?.inventory?.error}
          href="/erp/inventory"
          icon={<Boxes className="size-6" />}
          number={animatedNumber(inventory?.activeKinds)}
          surface="dashboard"
          title="在库物料种类"
        />
        <MetricCard
          animateNumber={!amountVisible}
          error={data?.inventory?.error}
          href="/erp/inventory"
          icon={amountVisible ? <Banknote className="size-6" /> : <History className="size-6" />}
          number={amountVisible ? `¥${number(inventory?.inventoryValue)}` : animatedNumber(inventory?.staleMaterials)}
          surface="dashboard"
          title={amountVisible ? "库存总金额" : "90 天无动动物料"}
        />
      </StaggerContainer>

      <DashboardSection
        description="点击仓库卡片直达该仓库的库存台账，预警角标可只看该仓预警物料"
        error={data?.inventory?.error}
        onRetry={() => void load()}
        title="仓库快捷入口"
      >
        <input
          className="mb-4 w-full max-w-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
          onChange={(event) => setWarehouseFilter(event.target.value)}
          placeholder="搜索仓库名称或编码..."
          type="search"
          value={warehouseFilter}
        />
        {filteredWarehouses.length === 0 ? (
          <EmptyHint>没有匹配的仓库，请调整搜索关键词。</EmptyHint>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredWarehouses.map((warehouse) => (
              <WarehouseCard
                key={warehouse.id}
                {...warehouse}
                amountVisible={amountVisible}
              />
            ))}
          </div>
        )}
      </DashboardSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <DashboardSection
          description="当前低于预警线的物料（按缺口大小排序，最多显示 8 条）"
          error={data?.inventory?.error}
          onRetry={() => void load()}
          title="预警物料榜"
        >
          {alertList.length === 0 ? (
            <EmptyHint>当前没有低于预警线的物料。</EmptyHint>
          ) : (
            <>
              <div className="space-y-2">
                {alertList.map((item) => (
                  <div key={`${item.warehouseId}-${item.materialId}`} className="dashboard-subcard flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{item.code} · {item.warehouse}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-[var(--danger)]">缺口 {number(item.gap)} {item.unit}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-[var(--text-tertiary)]">现存 {number(item.quantity)} / 预警线 {number(item.threshold)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <SectionLink href="/erp/inventory?alertOnly=1" label="查看全部预警" />
            </>
          )}
        </DashboardSection>

        <DashboardSection
          description="最近 8 条出入库与调拨流水"
          error={data?.movements?.error}
          onRetry={() => void load()}
          title="最近出入库动态"
        >
          {movementItems.length === 0 ? (
            <EmptyHint>还没有出入库记录——完成第一笔入库后，这里会显示最新动态。</EmptyHint>
          ) : (
            <div className="space-y-2">
              {movementItems.map((item) => {
                const meta = movementMeta[item.type] || { label: item.type, className: "bg-gray-100 text-gray-600" };
                return (
                  <div key={item.id} className="dashboard-subcard flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.materialName}</p>
                        <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{item.warehouse} · {item.materialCode}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{number(item.quantity)} {item.unit}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{formatShortTime(item.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardSection>
      </div>

      <SurfaceCard className="p-5" variant="dashboard">
        <button
          className="flex w-full items-center justify-between gap-4 text-left"
          onClick={() => setShowErpExtras((visible) => !visible)}
          type="button"
        >
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">生产与采购</h2>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">生产执行、齐套缺料与采购供应风险（相关模块启用后自动显示数据）</p>
          </div>
          <span className="shrink-0 text-sm font-medium text-[var(--brand-orange)]">{showErpExtras ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {showErpExtras && (
          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            <DashboardSection
              description="生产工单进度、交期和缺料风险"
              error={data?.production?.error}
              onRetry={() => void load()}
              title="生产执行"
            >
              {hasProductionData ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <SectionMetric label="已逾期" value={number(production?.kpis?.overdue)} tone="danger" />
                    <SectionMetric label="待齐套" value={number(production?.kpis?.pendingKitCheck)} tone="warning" />
                    <SectionMetric label="缺料影响工单" value={number(production?.totals?.shortageOrders)} tone="danger" />
                    <SectionMetric label="7 天内到期（含逾期）" value={number(production?.totals?.riskOrders)} tone="warning" />
                  </div>
                  <SectionLink href="/erp/production-orders" label="查看生产工单" />
                </>
              ) : (
                <EmptyHint>生产工单模块暂未产生数据——创建生产工单后，这里会显示逾期、齐套与缺料风险。</EmptyHint>
              )}
            </DashboardSection>

            <DashboardSection
              description="齐套结果严格沿用现有统计公式"
              error={data?.kitCheck?.error}
              onRetry={() => void load()}
              title="齐套和缺料"
            >
              {kit?.total > 0 ? (
                <>
                  <div className="dashboard-subcard rounded-[var(--radius-md)] p-5 backdrop-blur-md backdrop-saturate-[1.04]">
                    <p className="text-sm text-[var(--text-secondary)]">齐套率</p>
                    <p className="mt-2 text-4xl font-semibold text-[var(--text-primary)] tabular-nums">
                      {kit?.rate === null || kit?.rate === undefined ? "暂无数据" : `${kit.rate}%`}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-[var(--text-tertiary)]">{kit?.formula}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <SectionMetric label="完全齐套" value={number(kit?.sufficient)} tone="success" />
                    <SectionMetric label="缺料" value={number(kit?.shortage)} tone="danger" />
                    <SectionMetric label="未检查" value={number(kit?.notChecked)} tone="neutral" />
                  </div>
                  <SectionLink href="/erp/kit-check-results" label="查看齐套结果" />
                </>
              ) : (
                <EmptyHint>齐套检查随生产工单使用，当前暂无工单可统计。</EmptyHint>
              )}
            </DashboardSection>

            <DashboardSection
              description="采购需求、延期明细与可见订单"
              error={data?.procurement?.error}
              onRetry={() => void load()}
              title="采购与供应"
            >
              {hasProcurementData ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <SectionMetric label="延期采购明细" value={number(procurement?.delayedItems)} tone="danger" />
                    <SectionMetric label="可见采购订单" value={number(procurement?.orders?.length)} tone="neutral" />
                  </div>
                  {procurement?.mode === "RECEIVING_ONLY" && (
                    <div className="mt-4 rounded-[var(--radius-sm)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
                      仓库视图仅显示收货执行所需字段，不展示采购价格。
                    </div>
                  )}
                  <SectionLink href="/erp/purchase-demands" label="查看采购需求" />
                </>
              ) : (
                <EmptyHint>采购模块暂未产生数据——录入采购需求后，这里会显示需求与延期风险。</EmptyHint>
              )}
            </DashboardSection>

            <DashboardSection
              description="待收货与近期作废提醒"
              error={data?.alerts?.error}
              onRetry={() => void load()}
              title="异常与提醒"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <SectionMetric label="在途采购单（待收货）" value={number(alerts?.pendingStockIn)} tone="warning" />
                {alerts?.recentVoids !== undefined && (
                  <SectionMetric label="最近 30 天作废" value={number(alerts?.recentVoids)} tone="danger" />
                )}
              </div>
            </DashboardSection>
          </div>
        )}
      </SurfaceCard>

      <section>
        <div className="mb-4">
          <h2 className="font-semibold text-[var(--text-primary)]">快捷操作</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">仅展示当前角色视图所需入口</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions[roleView].map((action) => <QuickAction key={action.href} {...action} />)}
        </div>
      </section>
    </PageContainer>
  );
}

function WarehouseCard({ id, name, code, kinds, alertCount, value, amountVisible }: { id: string; name: string; code: string; kinds: number; alertCount: number; value?: number; amountVisible: boolean }) {
  return (
    <div className="dashboard-subcard flex h-full flex-col rounded-[var(--radius-md)] p-4 backdrop-blur-md backdrop-saturate-[1.04]">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]">
          <Warehouse className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-[var(--text-primary)]">{name}</p>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">编码：{code}</p>
        </div>
        {alertCount > 0 && (
          <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">预警 {alertCount}</span>
        )}
      </div>
      <div className="mt-3 flex-1 space-y-1 text-sm">
        <p className="text-[var(--text-secondary)]">{kinds > 0 ? `在库 ${number(kinds)} 种物料` : "暂无在库物料"}</p>
        {amountVisible && value !== undefined && (
          <p className="tabular-nums text-[var(--text-tertiary)]">库存金额 ¥{number(value)}</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-[var(--border)] pt-3">
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-orange)] hover:text-[var(--brand-orange-hover)]" href={`/erp/inventory?warehouseId=${id}`}>
          进入台账 <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {alertCount > 0 && (
          <Link className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700" href={`/erp/inventory?warehouseId=${id}&alertOnly=1`}>
            看预警 {alertCount} 项 <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}

function SectionMetric({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  const toneClasses = {
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    neutral: "text-[var(--text-primary)]",
  }[tone];

  return (
    <div className="dashboard-subcard rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
      <p className={`text-2xl font-semibold tabular-nums ${toneClasses}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{label}</p>
    </div>
  );
}

function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-orange)] hover:text-[var(--brand-orange-hover)]" href={href}>
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function QuickAction({ label, description, href, icon: Icon }: { label: string; description: string; href: string; icon: LucideIcon }) {
  return (
    <Link className="block rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]" href={href}>
      <SurfaceCard className="flex h-full items-center gap-4 p-4" variant="dashboardInteractive">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--text-primary)]">{label}</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
      </SurfaceCard>
    </Link>
  );
}
