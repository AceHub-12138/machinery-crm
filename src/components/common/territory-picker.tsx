"use client";

import { useState } from "react";
import { PROVINCE_CITY_MAP, PROVINCE_OPTIONS } from "@/lib/region-data";

export type Territory = { province: string; cities: string[] };

/**
 * 负责省市勾选树。
 * - 勾选省份 = 负责该省;展开后可只勾选部分市;
 * - 省份已勾选但不选任何市 = 负责整省;
 * - 直辖市/特别省份(无下级市)按整体处理。
 * disabled 时(例如选了「全区域」)整体置灰。
 */
export function TerritoryPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Territory[];
  onChange: (next: Territory[]) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const selectedMap = new Map(value.map((t) => [t.province, t.cities || []]));

  const emit = (map: Map<string, string[]>) =>
    onChange([...map.entries()].map(([province, cities]) => ({ province, cities })));

  const toggleProvince = (p: string) => {
    if (disabled) return;
    const next = new Map(selectedMap);
    if (next.has(p)) next.delete(p);
    else next.set(p, []);
    emit(next);
  };

  const toggleCity = (p: string, c: string) => {
    if (disabled) return;
    const cities = [...(selectedMap.get(p) || [])];
    const i = cities.indexOf(c);
    if (i >= 0) cities.splice(i, 1);
    else cities.push(c);
    const next = new Map(selectedMap);
    next.set(p, cities);
    emit(next);
  };

  return (
    <div
      className={`border border-gray-200 rounded-lg p-3 max-h-72 overflow-auto space-y-1 ${
        disabled ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      {PROVINCE_OPTIONS.filter((p) => p !== "国外").map((p) => {
        const checked = selectedMap.has(p);
        const cityList = PROVINCE_CITY_MAP[p] || [];
        const selCities = selectedMap.get(p) || [];
        const hasCities = cityList.length > 0;
        return (
          <div key={p}>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm flex-1 cursor-pointer">
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleProvince(p)} />
                <span>{p}</span>
                {checked && hasCities && (
                  <span className="text-xs text-gray-400">
                    {selCities.length === 0 ? "整省" : `${selCities.length} 个市`}
                  </span>
                )}
              </label>
              {checked && hasCities && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:text-blue-800"
                  onClick={() => setExpanded(expanded === p ? null : p)}
                >
                  {expanded === p ? "收起" : "选择市"}
                </button>
              )}
            </div>
            {checked && hasCities && expanded === p && (
              <div className="ml-6 mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1">
                {cityList.map((c) => (
                  <label key={c} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selCities.includes(c)}
                      disabled={disabled}
                      onChange={() => toggleCity(p, c)}
                    />
                    <span>{c}</span>
                  </label>
                ))}
                <div className="col-span-2 sm:col-span-3 text-[11px] text-gray-400 mt-1">
                  不勾选任何市 = 负责整省
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 把负责范围summarize成一行中文,用于表格展示 */
export function summarizeTerritories(territories: Territory[] | undefined, viewScope?: string): string {
  if (viewScope === "ALL") return "全区域";
  if (!territories || territories.length === 0) return "未分配";
  return territories
    .map((t) => (t.cities && t.cities.length > 0 ? `${t.province}(${t.cities.join("、")})` : t.province))
    .join("；");
}
