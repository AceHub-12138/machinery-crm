"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeliveryMilestones } from "./DeliveryMilestones";
import { HeaderBar } from "./HeaderBar";
import { KpiRail } from "./KpiRail";
import { ReminderRail } from "./ReminderRail";
import { ShipmentMap } from "./ShipmentMap";
import { TargetRing } from "./TargetRing";
import { CURSOR_IDLE_HIDE_MS } from "./cursor-idle";
import { createSalesScreenRefresher } from "@/modules/screen/sales-screen-refresher";
import {
  computeStageScale,
  resolveSalesScreenLayout,
  SALES_SCREEN_STAGE_HEIGHT,
  SALES_SCREEN_STAGE_WIDTH,
  type ScreenModuleId,
} from "@/modules/screen/sales-screen-layout";
import type { PublicSalesScreenPayload } from "@/modules/screen/public-types";

/**
 * 大屏客户端外壳。
 *
 * 布局由纯解析器 resolveSalesScreenLayout 的计划驱动：
 * 可见模块与开关严格一致，格子全部显式放置，不堆叠条件类名。
 * 首屏内容来自服务端取好的 initialPayload，客户端每 60 秒轮询公开 API，
 * 失败时保留最后一份正确数据。
 */
export function SalesScreenBoard({
  initialPayload,
  publicId,
  kiosk = false,
  initialFit = true,
}: {
  initialPayload: PublicSalesScreenPayload;
  publicId: string;
  kiosk?: boolean;
  initialFit?: boolean;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const plan = useMemo(() => resolveSalesScreenLayout(payload.modules), [payload.modules]);
  const stageRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  // kiosk 初始即视为闲置：LED 静置时无光标，指针一动立即显示
  const [cursorIdle, setCursorIdle] = useState(kiosk);

  // 数据轮询：成功替换 payload；失败保留最后一份正确数据；卸载时清理
  useEffect(() => {
    const refresher = createSalesScreenRefresher({
      publicId,
      initialPayload,
      onPayload: setPayload,
    });
    refresher.start();
    return () => refresher.stop();
  }, [publicId, initialPayload]);

  // kiosk 光标闲置隐藏：只挂在大屏根节点子树上，非 kiosk 不监听
  useEffect(() => {
    if (!kiosk) return;
    const root = rootRef.current;
    if (!root) return;
    const armHide = () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setCursorIdle(true), CURSOR_IDLE_HIDE_MS);
    };
    const onPointerMove = () => {
      setCursorIdle(false);
      armHide();
    };
    armHide();
    root.addEventListener("pointermove", onPointerMove);
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, [kiosk]);

  // 等比缩放：默认按视口缩放 1920×1080；?fit=0 时保持 1:1。只作用于大屏自身节点。
  useEffect(() => {
    if (!initialFit) return;
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;

    const apply = () => {
      const scale = computeStageScale(window.innerWidth, window.innerHeight);
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = "top left";
      frame.style.width = `${SALES_SCREEN_STAGE_WIDTH * scale}px`;
      frame.style.height = `${SALES_SCREEN_STAGE_HEIGHT * scale}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [initialFit]);

  const renderRegion = (id: ScreenModuleId) => {
    switch (id) {
      case "operatingKpis":
        return (
          <KpiRail
            kpis={payload.kpis}
            collection={payload.collection}
            deliverySummary={payload.delivery.summary}
          />
        );
      case "deliveryMap":
        return (
          <ShipmentMap
            routes={payload.delivery.routes}
            summary={payload.delivery.summary}
            mapBox={plan.mapBox ?? { width: 880, height: 838 }}
          />
        );
      case "collection":
        return <TargetRing collection={payload.collection} periodLabel={payload.period.label} />;
      case "deliveryAlerts":
        return (
          <ReminderRail summary={payload.delivery.summary} reminders={payload.delivery.reminders} />
        );
      case "deliveryMilestones":
        return (
          <DeliveryMilestones
            milestones={payload.delivery.milestones}
            summary={payload.delivery.summary}
          />
        );
    }
  };

  const upperRegions = plan.regions.filter((region) => region.column !== "bottom");
  const rightRegions = upperRegions.filter((region) => region.column === "right");
  const otherRegions = upperRegions.filter((region) => region.column !== "right");
  const bottomRegion = plan.regions.find((region) => region.column === "bottom");

  return (
    <div
      className="sales-screen-root"
      data-kiosk={kiosk ? "1" : undefined}
      data-cursor-idle={kiosk && cursorIdle ? "1" : undefined}
      ref={rootRef}
    >
      <div className="screen-frame" ref={frameRef}>
        <main id="screen-stage" className="screen-stage" ref={stageRef}>
          <HeaderBar periodLabel={payload.period.label} displayNotice={payload.displayNotice} />

          <div
            className="screen-stage-grid"
            style={{
              gridTemplateColumns: plan.columns.map((column) => column.track).join(" "),
              gridTemplateRows: plan.rows,
            }}
          >
            {otherRegions.map((region) => (
              <div
                key={region.id}
                className={`screen-cell ${region.id === "deliveryMap" ? "map-panel overflow-hidden rounded-[var(--radius)]" : ""}`}
                style={{
                  gridColumn: `${region.gridColumn} / span ${region.gridColumnSpan}`,
                  gridRow: region.gridRow,
                }}
              >
                {renderRegion(region.id)}
              </div>
            ))}

            {rightRegions.length > 0 ? (
              <div
                className="screen-cell"
                style={{
                  gridColumn: `${rightRegions[0]!.gridColumn} / span ${rightRegions[0]!.gridColumnSpan}`,
                  gridRow: 1,
                }}
              >
                <div
                  className="screen-right-col h-full"
                  style={{ gridTemplateRows: plan.rightRows ?? undefined }}
                >
                  {rightRegions.map((region) => (
                    <div key={region.id} className="screen-cell" style={{ gridRow: region.rightRow ?? 1 }}>
                      {renderRegion(region.id)}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {bottomRegion ? (
              <div
                className="screen-cell"
                style={{
                  gridColumn: `1 / span ${bottomRegion.gridColumnSpan}`,
                  gridRow: bottomRegion.gridRow,
                }}
              >
                {renderRegion(bottomRegion.id)}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
