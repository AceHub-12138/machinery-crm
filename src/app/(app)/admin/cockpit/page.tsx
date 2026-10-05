"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  FileClock,
  Gauge,
  HeartPulse,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { StaggerContainer } from "@/components/motion/StaggerContainer";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DISPLAY_VERSION } from "@/lib/changelog";
import { MOTION_SEQUENCE } from "@/lib/motion/config";

type HealthItem = {
  name: string;
  status: "OK" | "UNAVAILABLE" | "NOT_CONNECTED";
  detail: string;
};

type HealthResponse = {
  generatedAt?: string;
  items?: HealthItem[];
  build?: { version?: string };
};

type ApprovalTask = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  createdAt?: string;
  href?: string;
};

const adminLinks = [
  { label: "用户管理", description: "账号、角色与组织信息", href: "/users", icon: UserCog },
  { label: "主数据", description: "维护统一业务基础资料", href: "/admin/master-data", icon: Database },
  { label: "配置中心", description: "查看平台业务配置", href: "/admin/config", icon: SlidersHorizontal },
  { label: "操作日志", description: "追溯关键业务操作", href: "/operation-logs", icon: FileClock },
  { label: "系统健康", description: "查看只读健康详情", href: "/admin/health", icon: HeartPulse },
] as const;

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无更新时间";
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({}));
}

export default function AdminCockpitPage() {
  const [health, setHealth] = useState<HealthResponse>();
  const [tasks, setTasks] = useState<ApprovalTask[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [healthError, setHealthError] = useState("");
  const [tasksError, setTasksError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadHealth() {
      try {
        const response = await fetch("/api/system/health", { cache: "no-store" });
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || "系统健康加载失败");
        if (active) setHealth(body);
      } catch (reason) {
        if (active) setHealthError(reason instanceof Error ? reason.message : "系统健康加载失败");
      } finally {
        if (active) setHealthLoading(false);
      }
    }

    async function loadTasks() {
      try {
        const response = await fetch("/api/system/tasks?view=approval", { cache: "no-store" });
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || "审批待办加载失败");
        if (active) setTasks(Array.isArray(body.items) ? body.items : []);
      } catch (reason) {
        if (active) setTasksError(reason instanceof Error ? reason.message : "审批待办加载失败");
      } finally {
        if (active) setTasksLoading(false);
      }
    }

    void loadHealth();
    void loadTasks();
    return () => {
      active = false;
    };
  }, []);

  const items = useMemo(() => health?.items || [], [health?.items]);
  const unavailableCount = items.filter((item) => item.status === "UNAVAILABLE").length;
  const healthyCount = items.filter((item) => item.status === "OK").length;
  const platformStatus = unavailableCount > 0 ? "存在异常" : healthLoading ? "检查中" : "运行中";

  return (
    <PageContainer className="space-y-6" variant="dashboard">
      <SurfaceCard className="p-6" variant="glass">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]">
            <Gauge className="size-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--brand-orange)]">平台管理 · 只读驾驶舱</p>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">管理员工作台</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
              汇总平台状态、审批事项与管理入口。页面不显示密钥、Token、Cookie、连接串或密码，也不提供在线重启、部署及 Shell 操作。
            </p>
          </div>
        </div>
      </SurfaceCard>

      <StaggerContainer className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" delay={MOTION_SEQUENCE.kpi}>
        <MetricCard
          error={healthError}
          icon={<ShieldCheck className="size-6" />}
          loading={healthLoading}
          number={platformStatus}
          title="平台状态"
        />
        <MetricCard
          hint="当前应用发布版本"
          icon={<BookOpenCheck className="size-6" />}
          number={DISPLAY_VERSION}
          title="平台版本"
        />
        <MetricCard
          error={healthError}
          hint={formatDateTime(health?.generatedAt)}
          icon={<Clock3 className="size-6" />}
          loading={healthLoading}
          number={healthLoading ? undefined : "已更新"}
          title="健康更新时间"
        />
        <MetricCard
          animateNumber
          error={tasksError}
          href="/tasks"
          hint="进入审批中心处理"
          icon={<ClipboardCheck className="size-6" />}
          loading={tasksLoading}
          number={tasks.length}
          title="待我审批"
        />
      </StaggerContainer>

      <StaggerContainer className="grid gap-4 sm:grid-cols-3" delay={MOTION_SEQUENCE.kpi}>
        <MetricCard
          animateNumber
          error={healthError}
          hint="仅统计健康接口明确标记为不可用的项目"
          icon={<AlertTriangle className="size-6" />}
          loading={healthLoading}
          number={unavailableCount}
          title="异常项"
        />
        <MetricCard
          hint="现有健康接口未提供该统计，本次未新增 API"
          icon={<Users className="size-6" />}
          number="未接入"
          title="活跃用户"
        />
        <MetricCard
          animateNumber
          error={healthError}
          hint={`正常 ${healthyCount} 项，共 ${items.length} 项`}
          href="/admin/health"
          icon={<Activity className="size-6" />}
          loading={healthLoading}
          number={items.length}
          title="健康检查项"
        />
      </StaggerContainer>

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <SurfaceCard className="p-5 xl:col-span-3">
          <SectionHeading description="数据来自 /api/system/health，仅展示状态，不提供控制动作" title="系统健康只读状态" />
          {healthLoading ? (
            <LoadingSkeleton className="mt-5" lines={7} />
          ) : healthError ? (
            <ErrorState message={healthError} title="系统健康暂时无法读取" />
          ) : items.length === 0 ? (
            <EmptyState title="暂无健康检查项" description="健康接口当前未返回可展示项目。" />
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {items.map((item) => <HealthItemCard item={item} key={item.name} />)}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="p-5 xl:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <SectionHeading description="进入统一待办处理审批事项" title="审批中心" />
            <Link className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--brand-orange)] hover:text-[var(--brand-orange-hover)]" href="/tasks">
              全部审批
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {tasksLoading ? (
            <LoadingSkeleton className="mt-5" lines={6} />
          ) : tasksError ? (
            <ErrorState message={tasksError} title="审批待办暂时无法读取" />
          ) : tasks.length === 0 ? (
            <EmptyState title="暂无待审批事项" description="当前没有需要处理的审批。" />
          ) : (
            <div className="mt-5 space-y-2">
              {tasks.slice(0, 5).map((task) => (
                <Link className="block rounded-[var(--radius-sm)] p-3 transition hover:bg-[var(--surface-hover)]" href={task.href || "/tasks"} key={task.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{task.title}</p>
                      {task.description && <p className="mt-1 line-clamp-1 text-xs text-[var(--text-secondary)]">{task.description}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={task.status || "PENDING"} type="approval" />
                      {task.priority && <span className="text-[11px] text-[var(--text-tertiary)]">{task.priority}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>

      <section>
        <SectionHeading description="进入平台管理的常用只读与配置页面" title="管理快捷入口" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {adminLinks.map((item) => <AdminLink key={item.href} {...item} />)}
        </div>
      </section>
    </PageContainer>
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

function HealthItemCard({ item }: { item: HealthItem }) {
  const config = {
    OK: { label: "正常", icon: CheckCircle2, classes: "bg-[var(--success-soft)] text-[var(--success)]" },
    UNAVAILABLE: { label: "异常", icon: AlertTriangle, classes: "bg-[var(--danger-soft)] text-[var(--danger)]" },
    NOT_CONNECTED: { label: "未接入", icon: Settings, classes: "bg-[var(--neutral-soft)] text-[var(--neutral)]" },
  }[item.status];
  const Icon = config.icon;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${config.classes}`}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{item.detail}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${config.classes}`}>{config.label}</span>
      </div>
    </div>
  );
}

function AdminLink({ label, description, href, icon: Icon }: { label: string; description: string; href: string; icon: LucideIcon }) {
  return (
    <Link className="block rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]" href={href}>
      <SurfaceCard className="h-full p-4" variant="interactive">
        <div className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <p className="mt-4 font-medium text-[var(--text-primary)]">{label}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
      </SurfaceCard>
    </Link>
  );
}
