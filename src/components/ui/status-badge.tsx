type StatusType =
  | "customer"
  | "contract"
  | "shipment"
  | "purchase"
  | "workorder"
  | "kit"
  | "stockin"
  | "approval";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

type StatusConfig = {
  label: string;
  tone: Tone;
};

export type StatusBadgeProps = {
  status: string;
  type?: StatusType;
};

const commonStatuses: Record<string, StatusConfig> = {
  DRAFT: { label: "草稿", tone: "neutral" },
  PENDING: { label: "待处理", tone: "warning" },
  APPROVED: { label: "已通过", tone: "success" },
  REJECTED: { label: "已驳回", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  COMPLETED: { label: "已完成", tone: "success" },
};

const statusesByType: Record<StatusType, Record<string, StatusConfig>> = {
  customer: {
    NEW_LEAD: { label: "新线索", tone: "info" },
    CONTACTED: { label: "已联系", tone: "info" },
    QUOTED: { label: "已报价", tone: "warning" },
    NEGOTIATING: { label: "洽谈中", tone: "warning" },
    WON: { label: "已成交", tone: "success" },
    LOST: { label: "已流失", tone: "danger" },
    INACTIVE: { label: "已停用", tone: "neutral" },
  },
  contract: {
    DRAFT: { label: "草稿", tone: "neutral" },
    SIGNED: { label: "已签订", tone: "info" },
    CANCELLED: { label: "已取消", tone: "danger" },
    COMPLETED: { label: "已完成", tone: "success" },
    ARCHIVED: { label: "已归档", tone: "neutral" },
  },
  shipment: {
    NOT_SHIPPED: { label: "未发货", tone: "neutral" },
    PARTIAL_SHIPPED: { label: "部分发货", tone: "warning" },
    SHIPPED: { label: "已发货", tone: "success" },
  },
  purchase: {
    DRAFT: { label: "草稿", tone: "neutral" },
    ORDERED: { label: "已下单", tone: "info" },
    PARTIAL_RECEIVED: { label: "部分到货", tone: "warning" },
    RECEIVED: { label: "已到货", tone: "success" },
    CANCELLED: { label: "已取消", tone: "danger" },
  },
  workorder: {
    DRAFT: { label: "草稿", tone: "neutral" },
    ISSUED: { label: "已下达", tone: "info" },
    CHANGE_PENDING: { label: "变更待审", tone: "warning" },
    CANCELLED: { label: "已取消", tone: "danger" },
  },
  kit: {
    NOT_CHECKED: { label: "未检查", tone: "neutral" },
    SUFFICIENT: { label: "齐套", tone: "success" },
    SHORTAGE: { label: "缺料", tone: "danger" },
  },
  stockin: {
    DRAFT: { label: "草稿", tone: "neutral" },
    CONFIRMED: { label: "已确认", tone: "success" },
    VOIDED: { label: "已作废", tone: "danger" },
  },
  approval: {
    PENDING: { label: "待审批", tone: "warning" },
    APPROVED: { label: "已通过", tone: "success" },
    REJECTED: { label: "已驳回", tone: "danger" },
    USED: { label: "已使用", tone: "neutral" },
  },
};

const toneClasses: Record<Tone, string> = {
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  info: "bg-[var(--info-soft)] text-[var(--info)]",
  neutral: "bg-[var(--neutral-soft)] text-[var(--neutral)]",
};

export function StatusBadge({ status, type }: StatusBadgeProps) {
  const normalizedStatus = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const config =
    (type ? statusesByType[type][normalizedStatus] : undefined) ??
    commonStatuses[normalizedStatus] ?? {
      label: status || "未知状态",
      tone: "neutral" as const,
    };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[config.tone]}`}
      data-tone={config.tone}
    >
      {config.label}
    </span>
  );
}
