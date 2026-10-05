"use client";

import { formatCount } from "./format";
import type { PublicSalesScreenPayload, PublicMilestoneSample } from "@/modules/screen/public-types";

type DeliverySummary = PublicSalesScreenPayload["delivery"]["summary"];

/**
 * 交付里程碑 —— 对外展示板块。
 *
 * 只呈现「什么设备、多少台、哪天出的」，加上遮掩后的合同号便于现场对照。
 * 左栏三个统计量全部来自显式汇总字段，不从样本数组长度推导。
 */
export function DeliveryMilestones({
  milestones,
  summary,
}: {
  milestones: PublicMilestoneSample[];
  summary: DeliverySummary;
}) {
  // 最近交付在前；样本上限由服务器控制，这里再截一次只是防御
  const ordered = [...milestones]
    .sort((a, b) => new Date(b.shipmentDate).getTime() - new Date(a.shipmentDate).getTime())
    .slice(0, 5);

  return (
    <div className="panel grid h-full grid-cols-[210px_1fr] items-stretch">
      <div className="flex flex-col justify-center gap-1 border-r border-[var(--hairline)] px-4">
        <p className="panel-eyebrow">Delivery</p>
        <p className="screen-text-label leading-tight font-bold text-[var(--ink)]">交付里程碑</p>
        {/* 三个统计量拆成两个 span：18px 下整串太宽，显式分行更易读 */}
        <p className="num screen-text-micro flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-none text-[var(--ink-3)]">
          <span>
            {formatCount(summary.shipmentCount)} 单 · {formatCount(summary.unitCount)} 台
          </span>
          <span className="text-[var(--ink-4)]">{formatCount(summary.regionCount)} 大区</span>
        </p>
      </div>

      {/* 三列自适应：auto-fit + minmax 让 5 张卡按可用宽度自己决定排几列 */}
      <div className="milestone-grid grid min-w-0 content-center gap-y-1.5 px-3 py-2 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {ordered.map((item) => {
          const day = new Date(item.shipmentDate);
          const dateLabel = Number.isNaN(day.getTime())
            ? "—"
            : `${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
          return (
            <article key={item.key} className="milestone-item flex min-w-0 flex-col justify-center px-3">
              <div className="flex shrink-0 items-center justify-between gap-2">
                {item.contractNumber ? (
                  <span
                    className="screen-text-micro num rounded-[3px] px-2 py-0.5 leading-none font-bold"
                    style={{ background: "rgba(69, 216, 238, 0.13)", color: "var(--c-collect)" }}
                  >
                    {item.contractNumber}
                  </span>
                ) : (
                  <span />
                )}
                <span className="num screen-text-micro leading-none text-[var(--ink-3)]">
                  {dateLabel}
                </span>
              </div>

              <p className="screen-text-label mt-1 truncate leading-none font-medium text-[var(--ink)]">
                {item.equipmentName}
              </p>
              <p className="num screen-text-caption mt-1 truncate leading-none text-[var(--ink-2)]">
                {item.equipmentModel || "—"} · {formatCount(item.unitCount)} 台
              </p>
            </article>
          );
        })}
        {ordered.length === 0 ? (
          <p className="screen-text-caption col-span-full flex items-center justify-center text-[var(--ink-3)]">
            暂无交付记录
          </p>
        ) : null}
      </div>
    </div>
  );
}
