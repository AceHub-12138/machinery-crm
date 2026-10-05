"use client";

import { Panel, PanelHead } from "./Panel";
import { formatCount, formatShortDate } from "./format";
import type { PublicSalesScreenPayload, PublicReminderSample } from "@/modules/screen/public-types";

type DeliverySummary = PublicSalesScreenPayload["delivery"]["summary"];
type ReminderGroups = PublicSalesScreenPayload["delivery"]["reminders"];

const TONES = {
  pending: { bar: "var(--c-pending)", text: "text-[var(--c-pending)]" },
  collect: { bar: "var(--c-collect)", text: "text-[var(--c-collect)]" },
  overdue: { bar: "var(--c-overdue)", text: "text-[var(--c-overdue)]" },
} as const;

/**
 * 一组发货提醒。
 *
 * 面板高只有 383（右列上下两块按内容分配），列表改成两条并排才装得下
 * （竖排三组会被 overflow 裁掉第三行，教训见视觉仓库设计规范第 7 节）。
 * 组头计数是全量汇总（显式 summary 字段），样本只列 2 条不丢信息。
 */
function ReminderGroup({
  title,
  count,
  items,
  tone,
}: {
  title: string;
  count: number;
  items: PublicReminderSample[];
  tone: keyof typeof TONES;
}) {
  return (
    <section className={`reminder-group reminder-${tone} flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1.5`}>
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: TONES[tone].bar }} />
          <h3 className="screen-text-caption truncate leading-none font-medium text-[var(--ink)]">
            {title}
          </h3>
        </div>
        <span className={`num screen-text-label shrink-0 leading-none ${TONES[tone].text}`}>
          {formatCount(count)}
        </span>
      </header>

      {/* 每条一行：日期 · 合同编号（hidden 模式回退省市） · 设备。
          每条只有约 272px，两个字段必然放不下，都显式 truncate：
          中间字段给固定基准（basis-28）先截断，设备名吃剩余宽度。 */}
      <ul className="screen-text-micro mt-1.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-x-4 gap-y-1.5 overflow-hidden">
        {items.slice(0, 2).map((item) => {
          const middle =
            item.contractNumber ??
            [item.province, item.city].filter((part): part is string => part !== null).join(" · ");
          return (
            <li key={item.key} className="flex min-w-0 items-baseline gap-1.5">
              <span className="num screen-text-micro shrink-0 leading-none text-[var(--ink-3)]">
                {formatShortDate(item.estimatedShipmentDate)}
              </span>
              <span className="screen-text-caption min-w-0 shrink basis-28 truncate leading-none text-[var(--ink)]">
                {middle}
              </span>
              <span className="screen-text-micro min-w-0 flex-1 truncate leading-none text-[var(--ink-3)]">
                {item.equipmentName}
                {item.equipmentModel ? ` ${item.equipmentModel}` : ""}
              </span>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="screen-text-micro leading-none text-[var(--ink-3)]">暂无数据</li>
        ) : null}
      </ul>
    </section>
  );
}

export function ReminderRail({
  summary,
  reminders,
}: {
  summary: DeliverySummary;
  reminders: ReminderGroups;
}) {
  const total = summary.todayDue + summary.sevenDayDue + summary.overdueDue;

  return (
    <Panel className="flex h-full min-h-0 flex-col">
      <PanelHead
        eyebrow="Fulfillment"
        title="交付预警"
        extra={
          <p className="num screen-text-label leading-none text-[var(--ink)]">
            {formatCount(total)}
            <span className="screen-text-micro ml-1.5 font-normal text-[var(--ink-3)]">待处理</span>
          </p>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-[var(--panel-pad)]">
        <ReminderGroup title="逾期未发" count={summary.overdueDue} items={reminders.overdue} tone="overdue" />
        <ReminderGroup title="今日应发" count={summary.todayDue} items={reminders.today} tone="pending" />
        <ReminderGroup title="7 日内待发" count={summary.sevenDayDue} items={reminders.sevenDays} tone="collect" />
      </div>
    </Panel>
  );
}
