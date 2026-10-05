import { leadStatusLabel } from "@/modules/crm/leads/presentation";

const statusClasses: Record<string, string> = {
  PENDING: "bg-[var(--warning-soft)] text-[var(--warning)]",
  HIGH_INTENT: "bg-[var(--success-soft)] text-[var(--success)]",
  MID_INTENT: "bg-[var(--info-soft)] text-[var(--info)]",
  LOW_INTENT: "bg-[var(--neutral-soft)] text-[var(--neutral)]",
  INVALID: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

export function LeadStatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses[status] || statusClasses.PENDING}`}>
      {label || leadStatusLabel(status)}
    </span>
  );
}
