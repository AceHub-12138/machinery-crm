"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  FileText,
  Filter,
  MapPinned,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { SalesTargetCard } from "@/components/dashboard/sales-target-card";
import { AmapShipmentMap } from "@/components/maps/amap-shipment-map";
import { MotionPage } from "@/components/motion/MotionPage";
import { StaggerContainer } from "@/components/motion/StaggerContainer";
import { MOTION_SEQUENCE } from "@/lib/motion/config";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { MetricCard } from "@/components/ui/metric-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FOLLOW_TYPE_LABELS } from "@/lib/constants";
import { PROVINCE_OPTIONS } from "@/lib/region-data";
import { dashboardKpiHrefs, formatLocalDate } from "@/modules/crm/dashboard/kpi-linkage";

const PRESETS = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "7d", label: "近7天" },
  { value: "month", label: "本月" },
  { value: "lastMonth", label: "上月" },
  { value: "quarter", label: "本季度" },
  { value: "year", label: "本年" },
  { value: "custom", label: "自定义" },
];

const CONTRACT_STATUS_OPTIONS = [
  { value: "", label: "全部合同" },
  { value: "DRAFT", label: "草稿" },
  { value: "SIGNED", label: "已确认" },
  { value: "PRODUCTION", label: "生产中" },
  { value: "SHIPPED", label: "已发货" },
  { value: "COMPLETED", label: "已完成" },
  { value: "ARCHIVED", label: "已归档" },
  { value: "CANCELLED", label: "已取消" },
];

const SHIPMENT_STATUS_OPTIONS = [
  { value: "", label: "全部发货" },
  { value: "NOT_SHIPPED", label: "待发货" },
  { value: "SHIPPED", label: "已发货" },
  { value: "OVERDUE", label: "逾期未发货" },
];

const fieldClassName =
  "min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-2 focus:ring-[var(--brand-orange-soft)]";

type DashboardKpiCard = {
  title: string;
  number: number;
  href: string;
  icon: ReactNode;
  numberFormat?: (value: number) => ReactNode;
  numberPrecision?: number;
};

function formatMoney(value: unknown) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "-";
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

class DashboardMapErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <SurfaceCard className="min-h-[520px] p-1" variant="dashboard">
          <ErrorState
            title="发货地图加载失败"
            message="地图组件暂时不可用；KPI、发货提醒和跟进数据仍可正常查看。"
          />
        </SurfaceCard>
      );
    }

    return this.props.children;
  }
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<any>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [showFilters, setShowFilters] = useState(true);
  const [preset, setPreset] = useState("month");
  const [customStart, setCustomStart] = useState(() => formatLocalDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => formatLocalDate(new Date()));
  const [province, setProvince] = useState("");
  const [salesUserId, setSalesUserId] = useState("");
  const [customerStatus, setCustomerStatus] = useState("");
  const [contractStatus, setContractStatus] = useState("");
  const [shipmentStatus, setShipmentStatus] = useState("");

  const sessionUser = session?.user as { id?: string; name?: string | null; role?: string } | undefined;
  const userRole = sessionUser?.role;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("preset", preset);
    if (preset === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    if (province) params.set("province", province);
    if (salesUserId) params.set("salesUserId", salesUserId);
    if (customerStatus) params.set("customerStatus", customerStatus);
    if (contractStatus) params.set("contractStatus", contractStatus);
    if (shipmentStatus) params.set("shipmentStatus", shipmentStatus);
    return params.toString();
  }, [preset, customStart, customEnd, province, salesUserId, customerStatus, contractStatus, shipmentStatus]);

  useEffect(() => {
    fetch("/api/crm/dashboard")
      .then((res) => res.json())
      .then((payload) => setActiveUsers(Array.isArray(payload.salesUsers) ? payload.salesUsers : []))
      .catch(() => setActiveUsers([]));
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/crm/dashboard?${query}`, { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error || `工作台数据加载失败（${response.status}）`);
        if (active) setData(payload);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "工作台数据加载失败");
          setData(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      active = false;
    };
  }, [query, reloadKey]);

  const clearFilters = () => {
    setProvince("");
    setSalesUserId("");
    setCustomerStatus("");
    setContractStatus("");
    setShipmentStatus("");
  };

  const kpiHrefs = data ? dashboardKpiHrefs(data.range, data.filters) : null;
  const kpiCards: DashboardKpiCard[] = data && kpiHrefs
    ? [
        { title: "客户总数", number: Number(data.stats.totalCustomers || 0), href: "/customers", icon: <Users className="size-6" /> },
        { title: "本周期新增客户", number: Number(data.stats.periodNewCustomers || 0), href: kpiHrefs.periodNewCustomers, icon: <UserPlus className="size-6" /> },
        {
          title: "本周期合同金额",
          number: Number(data.stats.periodContractAmount || 0),
          numberFormat: formatMoney,
          numberPrecision: 2,
          href: kpiHrefs.periodContractAmount,
          icon: <FileText className="size-6" />,
        },
        { title: "本周期发货记录", number: Number(data.stats.periodShipments || 0), href: kpiHrefs.periodShipments, icon: <Truck className="size-6" /> },
        { title: "逾期发货", number: Number(data.stats.overdueShipmentDue || 0), href: kpiHrefs.overdueShipmentDue, icon: <AlertTriangle className="size-6" /> },
        { title: "待跟进", number: Number(data.stats.sevenDayFollowUp || 0), href: "/reminders", icon: <Clock className="size-6" /> },
      ]
    : [];

  return (
    <PageContainer className="dashboard-atmosphere space-y-6" variant="dashboard">
      <MotionPage className="space-y-6" enabled={Boolean(data)}>
        <SurfaceCard className="overflow-hidden p-6" variant="dashboard">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]">
              <MapPinned className="size-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--brand-orange)]">CRM · 销售经营视图</p>
              <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
                欢迎回来{sessionUser?.name ? `，${sessionUser.name}` : ""}
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                聚焦客户增长、合同回款、发货履约与近期跟进。
              </p>
            </div>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
            onClick={() => setShowFilters((value) => !value)}
            type="button"
          >
            <Filter className="size-4" aria-hidden="true" />
            {showFilters ? "收起筛选" : "展开筛选"}
          </button>
        </div>
        </SurfaceCard>

        {showFilters && (
          <SurfaceCard className="space-y-4 p-5" variant="dashboard">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <CalendarDays className="size-4 text-[var(--brand-orange)]" aria-hidden="true" />
            统计周期与业务维度
          </div>
          <div className="overflow-x-auto pb-1">
            <SegmentedControl options={PRESETS} value={preset} onChange={setPreset} />
          </div>
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                开始日期
                <input className={fieldClassName} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                结束日期
                <input className={fieldClassName} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {userRole === "SUPER_ADMIN" && (
              <select aria-label="省份" className={fieldClassName} value={province} onChange={(event) => setProvince(event.target.value)}>
                <option value="">全部省份</option>
                {PROVINCE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            )}
            <select aria-label="业务员" className={fieldClassName} value={salesUserId} onChange={(event) => setSalesUserId(event.target.value)}>
              <option value="">全部业务员</option>
              {activeUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select aria-label="客户状态" className={fieldClassName} value={customerStatus} onChange={(event) => setCustomerStatus(event.target.value)}>
              <option value="">全部客户</option>
              <option value="NEW_LEAD">新线索</option>
              <option value="QUOTED">已报价</option>
              <option value="WON">已成交</option>
              <option value="INACTIVE">暂停跟进</option>
              <option value="LOST">流失客户</option>
            </select>
            <select aria-label="合同状态" className={fieldClassName} value={contractStatus} onChange={(event) => setContractStatus(event.target.value)}>
              {CONTRACT_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="发货状态" className={fieldClassName} value={shipmentStatus} onChange={(event) => setShipmentStatus(event.target.value)}>
              {SHIPMENT_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <button className="text-sm text-[var(--text-tertiary)] transition hover:text-[var(--brand-orange)]" onClick={clearFilters} type="button">
            清空维度筛选
          </button>
          </SurfaceCard>
        )}
      </MotionPage>

      {loading && !data ? (
        <DashboardLoadingState />
      ) : error && !data ? (
        <DashboardErrorState error={error} onRetry={() => setReloadKey((value) => value + 1)} />
      ) : data ? (
        <DashboardMotionContent
          kpiCards={kpiCards}
          mapAndTarget={(
            <div className="grid min-w-0 items-stretch gap-6 sm:grid-cols-2">
              <DashboardMapErrorBoundary resetKey={query}>
                <MotionPage delay={MOTION_SEQUENCE.rest} offset={0}>
                  <SurfaceCard className="min-w-0 p-1" variant="dashboard">
                    <AmapShipmentMap shipments={data.shipmentPaths || []} />
                  </SurfaceCard>
                </MotionPage>
              </DashboardMapErrorBoundary>
              <SalesTargetCard
                currentUserId={sessionUser?.id}
                isSuperAdmin={userRole === "SUPER_ADMIN"}
                salesUsers={data.salesUsers || activeUsers}
              />
            </div>
          )}
        >
          <div className="grid gap-6 md:grid-cols-3">
            <ShipmentReminder title="今日应发货" items={data.shipmentReminders.today} count={data.stats.todayShipmentDue} tone="warning" href="/shipments?status=NOT_SHIPPED" />
            <ShipmentReminder title="7天内待发货" items={data.shipmentReminders.sevenDays} count={data.stats.sevenDayShipmentDue} tone="info" href="/shipments?status=NOT_SHIPPED" />
            <ShipmentReminder title="已逾期未发货" items={data.shipmentReminders.overdue} count={data.stats.overdueShipmentDue} tone="danger" href="/shipments?status=OVERDUE" />
          </div>
          {Object.values(data.afterSalesReminders || {}).some((items: any) => items.length > 0) && <div className="grid gap-6 md:grid-cols-3">
            <AfterSalesReminder title="进行中" items={data.afterSalesReminders.inProgress} tone="info" href="/after-sales?reminder=in-progress" />
            <AfterSalesReminder title="超时未回执" items={data.afterSalesReminders.overdue} tone="danger" href="/after-sales?reminder=overdue" />
            <AfterSalesReminder title="已完成未闭环" items={data.afterSalesReminders.completedUnclosed} tone="warning" href="/after-sales?reminder=completed-unclosed" />
          </div>}

          <div className="grid gap-6 lg:grid-cols-3">
            <SurfaceCard className="p-5" variant="dashboard">
              <SectionHeading title="周期统计" description="按当前筛选周期汇总" />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <CompactMetric label="新增合同" value={data.stats.periodNewContracts} />
                <CompactMetric label="周期回款" value={formatMoney(data.stats.periodPaidAmount)} />
                <CompactMetric label="当前未回款" value={formatMoney(data.stats.totalUnpaidAmount)} />
                <CompactMetric label="部分回款合同" value={data.stats.partialPaidContracts} />
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-5" variant="dashboard">
              <SectionHeading title="最近跟进动态" description="最近 8 条客户沟通记录" />
              {!data.recentFollows?.length ? (
                <EmptyState title="暂无跟进记录" description="完成客户跟进后，动态会显示在这里。" />
              ) : (
                <div className="mt-5 space-y-4">
                  {data.recentFollows.map((follow: any) => (
                    <div className="flex gap-3" key={follow.id}>
                      <div className="mt-2 size-2 shrink-0 rounded-full bg-[var(--brand-orange)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--brand-orange)]" href={`/customers/${follow.customer.id}`}>
                            {follow.customer.companyName}
                          </Link>
                          <span className="rounded-full bg-[var(--neutral-soft)] px-2 py-0.5 text-xs text-[var(--neutral)]">
                            {FOLLOW_TYPE_LABELS[follow.followType]}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{follow.content}</p>
                        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{follow.user.name} · {formatDate(follow.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-5" variant="dashboard">
              <SectionHeading title="待跟进客户" description="按下次跟进日期优先展示" />
              {!data.followUpCustomers?.length ? (
                <EmptyState title="暂无待跟进客户" description="当前筛选范围内没有到期待跟进客户。" />
              ) : (
                <div className="mt-4 space-y-2">
                  {data.followUpCustomers.map((customer: any) => (
                    <Link className="block rounded-[var(--radius-sm)] p-3 transition hover:bg-[var(--surface-hover)]" href={`/customers/${customer.id}`} key={customer.id}>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{customer.companyName}</p>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {customer.contactName} · {customer.assignedUser?.name || "未分配"} · {formatDate(customer.nextFollowDate)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </SurfaceCard>
          </div>
        </DashboardMotionContent>
      ) : (
        <SurfaceCard className="p-1" variant="dashboard"><EmptyState title="暂无工作台数据" /></SurfaceCard>
      )}
    </PageContainer>
  );
}

function DashboardLoadingState() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <MetricCard key={index} loading surface="dashboard" title="正在加载" />
        ))}
      </div>
      <SurfaceCard className="p-6" variant="dashboard">
        <LoadingSkeleton lines={8} />
      </SurfaceCard>
    </>
  );
}

function DashboardErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <SurfaceCard className="p-1" variant="dashboard">
      <ErrorState message={error} onRetry={onRetry} title="CRM 工作台暂时无法加载" />
    </SurfaceCard>
  );
}

function DashboardMotionContent({
  children,
  kpiCards,
  mapAndTarget,
}: {
  children: ReactNode;
  kpiCards: DashboardKpiCard[];
  mapAndTarget: ReactNode;
}) {
  return (
    <>
      <StaggerContainer className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" delay={MOTION_SEQUENCE.kpi}>
        {kpiCards.map((card) => (
          <MetricCard animateNumber key={card.title} surface="dashboard" {...card} />
        ))}
      </StaggerContainer>
      {mapAndTarget}
      <MotionPage className="space-y-6" delay={MOTION_SEQUENCE.rest}>
        {children}
      </MotionPage>
    </>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="font-semibold text-[var(--text-primary)]">{title}</h2>
      {description && <p className="mt-1 text-sm text-[var(--text-tertiary)]">{description}</p>}
    </div>
  );
}

function ShipmentReminder({ title, items = [], count = items.length, tone, href }: { title: string; items?: any[]; count?: number; tone: "warning" | "info" | "danger"; href: string }) {
  const toneClasses = {
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
    info: "bg-[var(--info-soft)] text-[var(--info)]",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  }[tone];

  return (
    <SurfaceCard className="flex h-[320px] flex-col p-5" variant="dashboard">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-[var(--brand-orange)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${toneClasses}`}>{count}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-tertiary)]">暂无记录</p>
      ) : (
        <div className="mt-3 flex-1 space-y-1 overflow-y-auto pr-1">
          {items.map((item) => (
            <Link className="block rounded-[var(--radius-sm)] p-3 transition hover:bg-[var(--surface-hover)]" href={`/contracts/${item.id}`} key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.customer?.companyName}</p>
                  <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{item.contractNo} · {item.equipmentName || item.equipmentModel}</p>
                </div>
                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{formatDate(item.estimatedShipmentDate)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}<Link href={href} className="mt-3 text-right text-sm font-medium text-[var(--brand-orange)] hover:underline">查看全部 →</Link>
    </SurfaceCard>
  );
}

function AfterSalesReminder({ title, items = [], tone, href }: { title: string; items?: any[]; tone: "warning" | "info" | "danger"; href: string }) {
  const toneClasses = { warning: "bg-[var(--warning-soft)] text-[var(--warning)]", info: "bg-[var(--info-soft)] text-[var(--info)]", danger: "bg-[var(--danger-soft)] text-[var(--danger)]" }[tone];
  return <SurfaceCard className="flex h-[320px] flex-col p-5" variant="dashboard"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock className="size-4 text-[var(--brand-orange)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--text-primary)]">售后 · {title}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${toneClasses}`}>{items.length}</span></div>{items.length === 0 ? <p className="mt-4 text-sm text-[var(--text-tertiary)]">暂无记录</p> : <div className="mt-3 flex-1 space-y-1 overflow-y-auto pr-1">{items.map((item) => <Link className="block rounded-[var(--radius-sm)] p-3 transition hover:bg-[var(--surface-hover)]" href={`/after-sales/${item.id}`} key={item.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-[var(--text-primary)]">{item.customerNameSnapshot}</p><p className="mt-1 break-words text-xs text-[var(--text-secondary)]">{item.orderNo} · {item.equipmentModelSnapshot}</p></div><span className="shrink-0 text-xs text-[var(--text-tertiary)]">{formatDate(item.dispatchDate)}</span></div></Link>)}</div>}<Link href={href} className="mt-3 text-right text-sm font-medium text-[var(--brand-orange)] hover:underline">查看全部 →</Link></SurfaceCard>;
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dashboard-subcard rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
      <p className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{label}</p>
    </div>
  );
}
