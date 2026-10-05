"use client";

import { AnimatedNumber } from "./AnimatedNumber";
import { Panel, PanelHead } from "./Panel";
import { formatCount, formatMoney, formatMoneyAmount } from "./format";
import type { PublicSalesScreenPayload } from "@/modules/screen/public-types";

type Kpis = PublicSalesScreenPayload["kpis"];
type Collection = PublicSalesScreenPayload["collection"];
type DeliverySummary = PublicSalesScreenPayload["delivery"]["summary"];

/** 等宽刻度条 —— 比连续渐变条更像仪表，也更符合工业语境。 */
function Gauge({
  ratio,
  tone = "brand",
  slots = 20,
  className = "",
}: {
  ratio: number;
  tone?: "brand" | "collect" | "overdue";
  slots?: number;
  className?: string;
}) {
  const filled = Math.max(0, Math.min(slots, Math.round(ratio * slots)));
  const cls = tone === "collect" ? "on-collect" : tone === "overdue" ? "on-overdue" : "on-brand";
  return (
    <div className={`gauge ${className}`} aria-hidden="true">
      {Array.from({ length: slots }, (_, index) => (
        <span className={index < filled ? cls : undefined} key={index} />
      ))}
    </div>
  );
}

function MiniStat({
  label,
  value,
  format,
  hint,
  tone = "neutral",
  money = false,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  hint: string;
  tone?: "neutral" | "brand" | "collect" | "partial" | "overdue";
  /** 金额类读数：不折行，字号降一档。 */
  money?: boolean;
}) {
  const toneClass = {
    neutral: "text-[var(--ink)]",
    brand: "text-[var(--brand-orange-hot)]",
    collect: "text-[var(--c-collect)]",
    partial: "text-[var(--c-pending)]",
    overdue: "text-[var(--c-overdue)]",
  }[tone];

  return (
    <article className="metric-tile flex flex-col justify-between px-3.5 py-3">
      <p className="screen-text-micro leading-none text-[var(--ink-3)]">{label}</p>
      {/* money：金额不许折行，字号比小整数降一档 */}
      <p className={`num mt-2.5 leading-none ${toneClass} ${money ? "money screen-text-label" : "screen-text-metric"}`}>
        <AnimatedNumber value={value} format={format} />
      </p>
      <p className="screen-text-micro mt-2 leading-none text-[var(--ink-3)]">{hint}</p>
    </article>
  );
}

export function KpiRail({
  kpis,
  collection,
  deliverySummary,
}: {
  kpis: Kpis;
  collection: Collection;
  deliverySummary: DeliverySummary;
}) {
  const periodPaid = Number(kpis.periodPaidAmount);
  const periodUnpaid = Number(kpis.periodUnpaidAmount);
  const periodTotal = periodPaid + periodUnpaid;
  const collectionRate = periodTotal > 0 ? periodPaid / periodTotal : 0;
  const totalContract = Number(collection.totalContractAmount);
  const totalUnpaid = Number(collection.totalUnpaidAmount);
  const unpaidShare = totalContract > 0 ? totalUnpaid / totalContract : 0;
  const targetRatio = collection.targetVisualRate / 100;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHead
        eyebrow="Sales KPI"
        title="经营指标"
        extra={
          <p className="num screen-text-label leading-none text-[var(--c-collect)]">
            {Math.round(collectionRate * 100)}%
            <span className="screen-text-micro ml-1.5 font-normal text-[var(--ink-3)]">回款率</span>
          </p>
        }
      />

      {/* 间距 10px / 内边距 16px：实测值，12/18 的组合会让内容比可用高度多出 8px */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-4">
        {/* 主指标：本期合同额 + 目标达成（目标与实际均已按同一倍率处理，比例自洽） */}
        <article className="kpi-primary relative min-h-0 shrink-0 overflow-hidden px-4 pt-3.5 pb-4">
          <div className="pointer-events-none absolute -top-10 -right-8 size-32 rounded-full bg-[rgba(238,125,44,0.11)] blur-2xl" />
          <div className="flex items-baseline justify-between gap-3">
            <p className="screen-text-label font-bold text-[var(--ink)]">本期合同额</p>
            <p className="num screen-text-micro text-[var(--ink-2)]">
              {formatCount(kpis.periodNewContracts)} 份新签
            </p>
          </div>
          <p className="num kpi-hero money screen-text-hero-lg mt-2.5 leading-none">
            <AnimatedNumber value={Number(kpis.periodContractAmount)} format={formatMoney} />
          </p>
          <div className="mt-4">
            <Gauge ratio={targetRatio} slots={22} />
            <div className="mt-2 flex items-baseline justify-between">
              <span className="screen-text-micro text-[var(--ink-3)]">
                月度目标 {formatMoneyAmount(collection.targetAmount)}
              </span>
              <span className="num screen-text-label leading-none text-[var(--brand-orange-hot)]">
                达成 {collection.targetRate.toFixed(1)}%
              </span>
            </div>
          </div>
        </article>

        {/* 回款结构 */}
        <article className="kpi-settlement shrink-0 px-4 py-2.5">
          <div className="flex items-baseline justify-between">
            <p className="screen-text-micro text-[var(--ink-3)]">回款结构</p>
            <p className="num screen-text-label money leading-none text-[var(--c-collect)]">
              {formatMoneyAmount(kpis.periodPaidAmount)}
            </p>
          </div>
          <div className="seg-bar mt-2.5">
            <div
              className="bg-[linear-gradient(90deg,#2fb8d4,var(--c-collect))]"
              style={{ width: `${collectionRate * 100}%` }}
            />
            <div
              className="bg-[linear-gradient(90deg,var(--brand-orange),var(--c-overdue))]"
              style={{ width: `${(1 - collectionRate) * 100}%` }}
            />
          </div>
          <div className="screen-text-micro mt-2.5 flex justify-between">
            <span className="text-[var(--c-collect)]">已回 {Math.round(collectionRate * 100)}%</span>
            <span className="text-[var(--brand-orange-hot)]">
              待回 {formatMoneyAmount(kpis.periodUnpaidAmount)}
            </span>
          </div>
        </article>

        {/* 4 宫格 */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5">
          <MiniStat label="客户总数" value={kpis.totalCustomers} format={formatCount} hint={`新增 ${formatCount(kpis.periodNewCustomers)}`} />
          <MiniStat label="本期发货" value={kpis.periodShipments} format={formatCount} hint={`待发 ${formatCount(deliverySummary.sevenDayDue)}`} tone="collect" />
          <MiniStat label="未回款" value={totalUnpaid} format={formatMoney} hint={`${formatCount(kpis.unpaidContracts)} 份未付`} tone="brand" money />
          <MiniStat label="部分回款" value={kpis.partialPaidContracts} format={formatCount} hint={`${Math.round(unpaidShare * 100)}% 敞口`} tone="partial" />
        </div>

        {/* 待处理预警：一格一数 */}
        <div className="attention-strip grid shrink-0 grid-cols-3">
          <div className="attention-cell px-2 py-3 text-center">
            <p className="screen-text-micro leading-none text-[rgba(232,163,61,0.85)]">今日跟进</p>
            <p className="num screen-text-metric mt-2.5 leading-none text-[var(--c-pending)]">
              {formatCount(kpis.todayFollowUp)}
            </p>
          </div>
          <div className="attention-cell attention-cell-risk px-2 py-3 text-center">
            <p className="screen-text-micro leading-none text-[rgba(242,85,90,0.85)]">逾期跟进</p>
            <p className="num screen-text-metric mt-2.5 leading-none text-[var(--c-overdue)]">
              {formatCount(kpis.overdueFollowUp)}
            </p>
          </div>
          <div className="attention-cell attention-cell-risk px-2 py-3 text-center">
            <p className="screen-text-micro leading-none text-[rgba(242,85,90,0.85)]">逾期发货</p>
            <p className="num screen-text-metric mt-2.5 leading-none text-[var(--c-overdue)]">
              {formatCount(deliverySummary.overdueDue)}
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
