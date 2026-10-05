"use client";

// 大川机床 CRM —— 全国发货路径图（天地图版）
// 本组件原使用高德(AMap)，现已改为 Leaflet + 天地图 WMTS 底图。
// 文件名与导出名 AmapShipmentMap 保持不变，避免改动 dashboard 引用。
// 视觉上：底图为天地图矢量图经深色滤镜处理，航线更细、光标更小，贴近航旅纵横风格。

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, MapPin } from "lucide-react";
import { loadLeaflet } from "@/lib/maps/amap";
import {
  FACTORY_ADDRESS,
  FACTORY_NAME,
  type ShipmentMapDestination,
  type ShipmentMapGeocodeResponse,
} from "@/lib/maps/types";

type AmapShipmentMapProps = {
  shipments: any[];
};

type RenderState = "idle" | "geocoding" | "loading-map" | "rendering" | "ready" | "error";

type FlowRoute = {
  path: number[][]; // [lat, lng] 数组
  marker: any;
  duration: number;
  offset: number;
};

// 瓦片改为经本站服务器中转（/api/map/tile），浏览器不再直连天地图、也不暴露密钥。
// 这样所有天地图请求都从服务器发出，配合“服务器端密钥 + IP白名单”即可正常授权。
function tileProxyUrl(layer: "vec" | "cva") {
  return `/api/map/tile?layer=${layer}&z={z}&x={x}&y={y}`;
}

function statusColor(status: string) {
  if (status === "SHIPPED") return "#67e8f9";
  if (status === "PARTIAL_SHIPPED") return "#facc15";
  return "#93c5fd";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function routeTitle(shipment: any, address: string) {
  return `
    <div style="min-width:200px;font-size:12px;line-height:1.6;color:#e0f2fe">
      <div style="font-weight:600;margin-bottom:4px;color:#a5f3fc">${escapeHtml(
        shipment.contract?.customer?.companyName || "客户"
      )}</div>
      <div>设备：${escapeHtml(
        shipment.equipmentName ||
          shipment.contract?.equipmentName ||
          shipment.contract?.equipmentModel ||
          "发货设备"
      )}</div>
      <div>合同：${escapeHtml(shipment.contract?.contractNo || "-")}</div>
      <div>地址：${escapeHtml(address)}</div>
    </div>
  `;
}

function factoryTitle() {
  return `<div style="font-size:12px;line-height:1.6;color:#e0f2fe"><b style="color:#a5f3fc">${escapeHtml(
    FACTORY_NAME
  )}</b><br/>${escapeHtml(FACTORY_ADDRESS)}</div>`;
}

function formatMapError(error: string) {
  if (!error) return "";
  if (error.includes("TIANDITU_KEY")) return "天地图密钥(tk)未配置，请在 .env 中设置 TIANDITU_KEY。";
  if (error.includes("权限") || error.includes("403") || error.includes("授权")) {
    return "天地图密钥被拒绝。请确认天地图控制台该应用的“IP白名单”包含服务器的出口IP（或暂时清空IP白名单），保存后等待 1-2 分钟再刷新。";
  }
  return error;
}

// createArcPath 在 [经度, 纬度] 空间内计算二次贝塞尔弧线
function createArcPath(start: number[], end: number[], bend = 0.22) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(distance) || distance < 0.01) return [start, end];

  const normalX = -dy / distance;
  const normalY = dx / distance;
  const arcHeight = Math.min(Math.max(distance * bend, 0.45), 5.2);
  const control = [
    (start[0] + end[0]) / 2 + normalX * arcHeight,
    (start[1] + end[1]) / 2 + normalY * arcHeight,
  ];

  return Array.from({ length: 48 }, (_, index) => {
    const t = index / 47;
    const oneMinusT = 1 - t;
    return [
      oneMinusT * oneMinusT * start[0] + 2 * oneMinusT * t * control[0] + t * t * end[0],
      oneMinusT * oneMinusT * start[1] + 2 * oneMinusT * t * control[1] + t * t * end[1],
    ];
  });
}

function positionOnPath(path: number[][], progress: number) {
  if (path.length <= 1) return path[0] || [0, 0];
  const scaled = progress * (path.length - 1);
  const index = Math.min(Math.floor(scaled), path.length - 2);
  const local = scaled - index;
  const current = path[index];
  const next = path[index + 1];
  return [
    current[0] + (next[0] - current[0]) * local,
    current[1] + (next[1] - current[1]) * local,
  ];
}

// 起点（工厂）光标：小巧的脉冲圆环 + 核心点 + 文字标签
function factoryMarkerContent(label: string) {
  return `
    <div style="transform:translate(-50%,-50%);position:relative;width:22px;height:22px;">
      <div style="position:absolute;inset:-7px;border-radius:999px;background:rgba(103,232,249,.12);box-shadow:0 0 18px rgba(103,232,249,.8);animation:dachuan-map-pulse 1.9s ease-in-out infinite;"></div>
      <div style="position:absolute;inset:6px;border-radius:999px;background:#e0ffff;border:2px solid #22d3ee;box-shadow:0 0 10px #67e8f9;"></div>
      <div style="position:absolute;left:16px;top:-5px;padding:3px 7px;border-radius:999px;background:rgba(2,8,23,.72);border:1px solid rgba(103,232,249,.5);font-size:11px;color:#ecfeff;white-space:nowrap;">${escapeHtml(label)}</div>
    </div>
  `;
}

// 终点（客户）光标：更小的发光点 + 文字标签
function customerMarkerContent(label: string, color: string) {
  return `
    <div style="transform:translate(-50%,-50%);position:relative;">
      <div style="width:8px;height:8px;border-radius:999px;background:#fff;border:2px solid ${color};box-shadow:0 0 8px ${color},0 0 16px ${color};"></div>
      <div style="position:absolute;left:11px;top:-9px;padding:2px 6px;border-radius:999px;background:rgba(2,8,23,.68);border:1px solid rgba(148,163,184,.35);font-size:11px;color:#e0f2fe;white-space:nowrap;">${escapeHtml(label)}</div>
    </div>
  `;
}

// 流光点：沿航线移动的小光点
function flowMarkerContent(color: string) {
  return `
    <div style="width:14px;height:14px;transform:translate(-50%,-50%);border-radius:999px;background:radial-gradient(circle,#ffffff 0 18%,${color} 28% 46%,rgba(255,255,255,0) 56%);box-shadow:0 0 7px ${color},0 0 16px ${color};pointer-events:none;"></div>
  `;
}

export function AmapShipmentMap({ shipments }: AmapShipmentMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const renderTokenRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  const [mapError, setMapError] = useState("");
  const [geocodeData, setGeocodeData] = useState<ShipmentMapGeocodeResponse | null>(null);
  const [renderState, setRenderState] = useState<RenderState>("idle");

  const geocodePayload = useMemo(
    () =>
      shipments.map((shipment, index) => ({
        id: String(shipment.id || index),
        address: shipment.receivingAddress || "",
      })),
    [shipments]
  );

  useEffect(() => {
    let active = true;

    async function resolveAddresses() {
      if (geocodePayload.length === 0) {
        setGeocodeData({ ok: true, origin: null, destinations: [], resolvedCount: 0, skippedCount: 0 });
        setMapError("");
        setRenderState("idle");
        return;
      }

      setRenderState("geocoding");
      setMapError("");

      try {
        const response = await fetch("/api/map/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinations: geocodePayload }),
        });

        let data: ShipmentMapGeocodeResponse | null = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!response.ok) {
          throw new Error(data?.error || `发货地址解析接口异常（${response.status}）`);
        }
        if (!data) {
          throw new Error("发货地址解析接口未返回有效数据");
        }
        if (data.ok === false) {
          throw new Error(data.error || "发货地址解析失败");
        }
        if (!data.origin) {
          throw new Error("起点地址解析失败，请检查工厂地址或天地图密钥。");
        }

        if (active) setGeocodeData(data);
      } catch (error) {
        if (active) {
          setGeocodeData(null);
          setMapError(error instanceof Error ? error.message : "地图数据加载失败");
          setRenderState("error");
        }
      }
    }

    resolveAddresses();
    return () => {
      active = false;
    };
  }, [geocodePayload]);

  useEffect(() => {
    let active = true;
    const token = renderTokenRef.current + 1;
    renderTokenRef.current = token;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    async function renderMap() {
      if (!mapRef.current || !geocodeData?.origin) return;

      // 瓦片已改为服务器中转，浏览器端不再需要密钥；密钥是否有效由地址解析阶段保证。
      const validDestinations = geocodeData.destinations.filter((d: ShipmentMapDestination) => Boolean(d.location));
      if (validDestinations.length === 0) {
        setMapError("当前发货记录没有可显示的有效收货坐标，请检查收货地址是否完整。");
        setRenderState("error");
        return;
      }

      try {
        setMapError("");
        setRenderState("loading-map");

        const container = mapRef.current;
        container.style.width = "100%";
        container.style.height = "100%";

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const L = await loadLeaflet();
        if (!active || !mapRef.current || token !== renderTokenRef.current) return;

        setRenderState("rendering");

        if (mapInstance.current) {
          mapInstance.current.remove();
          mapInstance.current = null;
        }

        const origin = geocodeData.origin;
        const originLngLat = [Number(origin.lng), Number(origin.lat)];
        const originLatLng = [originLngLat[1], originLngLat[0]];

        const map = L.map(mapRef.current, {
          center: originLatLng,
          zoom: 5,
          minZoom: 4,
          maxZoom: 12,
          zoomControl: false,
          attributionControl: true,
          zoomSnap: 0.25,
          worldCopyJump: false,
        });
        map.attributionControl.setPrefix(false);
        L.control.zoom({ position: "bottomright" }).addTo(map);

        L.tileLayer(tileProxyUrl("vec"), {
          minZoom: 1,
          maxZoom: 18,
          attribution: "© 天地图",
        }).addTo(map);
        L.tileLayer(tileProxyUrl("cva"), {
          minZoom: 1,
          maxZoom: 18,
        }).addTo(map);

        mapInstance.current = map;

        const allLatLngs: number[][] = [originLatLng];
        const flowRoutes: FlowRoute[] = [];
        const popup = L.popup({ closeButton: false, className: "dc-popup", offset: [0, -4], autoPan: false });

        // 起点光标
        const factoryIcon = L.divIcon({
          html: factoryMarkerContent(FACTORY_NAME),
          className: "dc-divicon",
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        const factoryMarker = L.marker(originLatLng, { icon: factoryIcon, zIndexOffset: 600 }).addTo(map);
        factoryMarker.on("mouseover", () => popup.setLatLng(originLatLng).setContent(factoryTitle()).openOn(map));
        factoryMarker.on("mouseout", () => map.closePopup(popup));

        geocodeData.destinations.forEach((destination: ShipmentMapDestination, destinationIndex: number) => {
          if (!destination.location) return;

          const shipmentIndex = shipments.findIndex((item) => String(item.id) === String(destination.id));
          const shipment = shipments[shipmentIndex >= 0 ? shipmentIndex : destinationIndex];
          if (!shipment) return;

          const destLngLat = [Number(destination.location.lng), Number(destination.location.lat)];
          const destLatLng = [destLngLat[1], destLngLat[0]];
          const color = statusColor(shipment.shipmentStatus);
          const customerName = shipment.contract?.customer?.companyName || destination.address || "客户";

          // 在 [经度,纬度] 空间算弧线，再转成 Leaflet 的 [纬度,经度]
          const arcLngLat = createArcPath(originLngLat, destLngLat, destinationIndex % 2 === 0 ? 0.24 : -0.2);
          const arcLatLng = arcLngLat.map(([lng, lat]) => [lat, lng]);
          allLatLngs.push(destLatLng);

          // 柔和的底层光晕（细）
          const glowLine = L.polyline(arcLatLng, {
            color,
            weight: 4,
            opacity: 0.16,
            lineJoin: "round",
            className: "dc-arc-glow",
            interactive: false,
          }).addTo(map);

          // 明亮的主航线（很细）
          const brightLine = L.polyline(arcLatLng, {
            color,
            weight: 1.3,
            opacity: 0.92,
            lineJoin: "round",
            className: "dc-arc-line",
            interactive: false,
          }).addTo(map);

          // 透明的“热区”线，加宽便于鼠标悬停
          const hitLine = L.polyline(arcLatLng, {
            color: "#000",
            weight: 14,
            opacity: 0,
            interactive: true,
          }).addTo(map);
          const html = routeTitle(shipment, destination.address);
          hitLine.on("mouseover", (e: any) => popup.setLatLng(e.latlng).setContent(html).openOn(map));
          hitLine.on("mousemove", (e: any) => popup.setLatLng(e.latlng));
          hitLine.on("mouseout", () => map.closePopup(popup));

          // 终点光标
          const customerIcon = L.divIcon({
            html: customerMarkerContent(customerName, color),
            className: "dc-divicon",
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          const customerMarker = L.marker(destLatLng, { icon: customerIcon, zIndexOffset: 500 }).addTo(map);
          customerMarker.on("mouseover", () => popup.setLatLng(destLatLng).setContent(html).openOn(map));
          customerMarker.on("mouseout", () => map.closePopup(popup));

          // 流光点
          const flowIcon = L.divIcon({
            html: flowMarkerContent(color),
            className: "dc-divicon",
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          const flowMarker = L.marker(originLatLng, { icon: flowIcon, zIndexOffset: 700, interactive: false }).addTo(map);

          void glowLine;
          void brightLine;

          flowRoutes.push({
            path: arcLatLng,
            marker: flowMarker,
            duration: 3200 + destinationIndex * 360,
            offset: destinationIndex * 680,
          });
        });

        const animateFlow = (time: number) => {
          if (!active || token !== renderTokenRef.current) return;
          flowRoutes.forEach((route) => {
            const progress = ((time + route.offset) % route.duration) / route.duration;
            const p = positionOnPath(route.path, progress);
            route.marker.setLatLng(p as any);
          });
          animationFrameRef.current = requestAnimationFrame(animateFlow);
        };
        if (flowRoutes.length > 0) {
          animationFrameRef.current = requestAnimationFrame(animateFlow);
        }

        const fit = () => {
          if (!active || token !== renderTokenRef.current) return;
          try {
            map.invalidateSize();
            if (allLatLngs.length > 1) {
              map.fitBounds(L.latLngBounds(allLatLngs as any), { padding: [56, 56], maxZoom: 9 });
            }
          } catch (fitError) {
            console.warn("[Dachuan CRM Map] fit view failed", fitError);
          }
        };

        map.whenReady(() => {
          fit();
          setRenderState("ready");
        });
        window.setTimeout(fit, 250);
        window.setTimeout(() => {
          fit();
          if (active && token === renderTokenRef.current) setRenderState("ready");
        }, 1000);
      } catch (error) {
        if (active) {
          console.error("[Dachuan CRM Map] render failed", error);
          setMapError(error instanceof Error ? error.message : "天地图加载失败");
          setRenderState("error");
        }
      }
    }

    renderMap();

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [geocodeData, shipments]);

  const resolvedCount =
    geocodeData?.destinations.filter((d: ShipmentMapDestination) => Boolean(d.location)).length || 0;
  const skippedCount = geocodeData?.skippedCount ?? Math.max((geocodeData?.destinations.length || 0) - resolvedCount, 0);
  const uniqueRegions = new Set(shipments.map((shipment) => shipment.contract?.customer?.province).filter(Boolean)).size;
  const displayError = formatMapError(mapError);
  const isBusy = renderState === "geocoding" || renderState === "loading-map" || renderState === "rendering";

  return (
    <div className="relative overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950 p-4 shadow-[0_18px_70px_rgba(8,47,73,.22)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,.22),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(59,130,246,.18),transparent_26%),linear-gradient(135deg,rgba(15,23,42,.4),rgba(8,47,73,.2))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />

      <div className="relative z-10 mb-4 flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,.22)]">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-cyan-50">全国发货路径图</h2>
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
                航线模式
              </span>
            </div>
            <p className="mt-1 text-xs text-cyan-100/60">
              起点：{FACTORY_ADDRESS} · 目的地根据客户收货地址解析
            </p>
            {skippedCount > 0 && !displayError && (
              <p className="mt-1 text-xs text-amber-200">{skippedCount} 条发货记录因地址不完整或解析失败已跳过。</p>
            )}
          </div>
        </div>

        <div className="grid w-full grid-cols-3 gap-2">
          <div className="min-w-0 rounded-lg border border-cyan-300/20 bg-slate-900/70 px-2 py-2 text-center text-cyan-50 sm:px-3">
            <p className="whitespace-nowrap text-[11px] text-cyan-100/55">已解析路径</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{resolvedCount}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-cyan-300/20 bg-slate-900/70 px-2 py-2 text-center text-cyan-50 sm:px-3">
            <p className="whitespace-nowrap text-[11px] text-cyan-100/55">发货记录</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{shipments.length}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-cyan-300/20 bg-slate-900/70 px-2 py-2 text-center text-cyan-50 sm:px-3">
            <p className="whitespace-nowrap text-[11px] text-cyan-100/55">省份</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{uniqueRegions || "-"}</p>
          </div>
        </div>
      </div>

      <div className="relative z-10 h-[520px] min-h-[520px] rounded-lg border border-cyan-300/20 overflow-hidden bg-slate-950 shadow-inner">
        <style>{`
          @keyframes dachuan-map-pulse {
            0%, 100% { transform: scale(.72); opacity: .46; }
            50% { transform: scale(1.18); opacity: .92; }
          }
          /* 天地图底图深色化滤镜（仅作用于瓦片，不影响航线/光标） */
          .dachuan-space-map .leaflet-tile-pane {
            filter: invert(1) hue-rotate(192deg) brightness(.62) contrast(1.18) saturate(.82);
          }
          .dachuan-space-map { background: #03060f; }
          .dachuan-space-map .leaflet-container { background: #03060f; }
          /* 航线发光 */
          .dachuan-space-map .dc-arc-line { filter: drop-shadow(0 0 3px currentColor); }
          .dachuan-space-map .dc-arc-glow { filter: blur(1.5px); }
          /* divIcon 透明容器 */
          .dachuan-space-map .dc-divicon { background: transparent; border: 0; }
          /* 悬停信息弹窗：深色 */
          .dc-popup .leaflet-popup-content-wrapper {
            background: rgba(2,8,23,.92);
            border: 1px solid rgba(103,232,249,.4);
            box-shadow: 0 0 24px rgba(34,211,238,.22);
            border-radius: 10px;
            color: #e0f2fe;
          }
          .dc-popup .leaflet-popup-content { margin: 10px 12px; }
          .dc-popup .leaflet-popup-tip {
            background: rgba(2,8,23,.92);
            border: 1px solid rgba(103,232,249,.4);
          }
          /* 缩放控件深色化 */
          .dachuan-space-map .leaflet-control-zoom a {
            background: rgba(2,8,23,.82);
            color: #a5f3fc;
            border-color: rgba(103,232,249,.3);
          }
          .dachuan-space-map .leaflet-control-zoom a:hover { background: rgba(8,47,73,.9); }
          .dachuan-space-map .leaflet-control-attribution {
            background: rgba(2,8,23,.6);
            color: rgba(186,230,253,.7);
          }
          .dachuan-space-map .leaflet-control-attribution a { color: rgba(186,230,253,.9); }
        `}</style>
        <div
          ref={mapRef}
          className="dachuan-space-map absolute inset-0 w-full h-full min-h-[520px]"
          style={{ width: "100%", height: "100%", minHeight: 520 }}
        />

        <div className="pointer-events-none absolute left-4 top-4 z-[500] rounded-lg border border-cyan-300/25 bg-slate-950/72 px-4 py-3 text-cyan-50 shadow-[0_0_32px_rgba(34,211,238,.18)] backdrop-blur">
          <p className="text-xs text-cyan-100/70">大川机床发货网络</p>
          <p className="text-sm font-semibold text-cyan-50">滕州工厂实时路径</p>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/78 to-transparent p-4">
          <div className="rounded-full border border-cyan-300/20 bg-slate-950/70 px-4 py-2 text-xs text-cyan-100/75 backdrop-blur">
            流光航线按当前筛选范围内发货记录生成
          </div>
          <div className="hidden rounded-full border border-cyan-300/20 bg-slate-950/70 px-4 py-2 text-xs text-cyan-100/75 backdrop-blur sm:block">
            {resolvedCount} / {shipments.length} 条路径
          </div>
        </div>

        {(isBusy || displayError || shipments.length === 0) && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 px-6 text-center text-sm text-cyan-50 backdrop-blur-sm">
            {isBusy ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-200" />
                <span>{renderState === "geocoding" ? "正在解析发货地址..." : "正在加载航线地图..."}</span>
              </div>
            ) : displayError ? (
              <div className="max-w-xl">
                <div className="flex justify-center mb-3 text-amber-300">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <p className="font-medium text-cyan-50">地图加载失败</p>
                <p className="mt-2 leading-6 text-cyan-50/80">{displayError}</p>
                <p className="mt-2 text-xs text-cyan-100/50">
                  此错误只影响地图显示，不影响客户、合同、发货等其他业务功能。
                </p>
              </div>
            ) : (
              "当前日期筛选范围内暂无发货路径"
            )}
          </div>
        )}
      </div>
    </div>
  );
}
