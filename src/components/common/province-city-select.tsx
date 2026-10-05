"use client";

import { PROVINCE_CITY_MAP, PROVINCE_OPTIONS } from "@/lib/region-data";

type Territory = { province: string; cities: string[] };

const baseCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100 disabled:text-gray-400";

/**
 * 省 → 市 级联选择。
 * - allowed 传入时(普通销售),只显示其负责的省/市;
 * - includeForeign 控制是否显示「国外」(仅全局用户建外贸客户时需要)。
 */
export function ProvinceCitySelect({
  province,
  city,
  onChange,
  allowed,
  includeForeign = true,
  disabled = false,
}: {
  province: string;
  city: string;
  onChange: (next: { province: string; city: string }) => void;
  allowed?: Territory[];
  includeForeign?: boolean;
  disabled?: boolean;
}) {
  let provinceOpts = [...PROVINCE_OPTIONS];
  if (!includeForeign) provinceOpts = provinceOpts.filter((p) => p !== "国外");
  if (allowed && allowed.length > 0) {
    const allowedProvinces = new Set(allowed.map((t) => t.province));
    provinceOpts = provinceOpts.filter((p) => allowedProvinces.has(p));
  }

  const isForeign = province === "国外";
  let cityOpts = province && !isForeign ? PROVINCE_CITY_MAP[province] || [] : [];
  if (allowed && allowed.length > 0 && province) {
    const t = allowed.find((x) => x.province === province);
    if (t && t.cities.length > 0) {
      cityOpts = cityOpts.filter((c) => t.cities.includes(c));
    }
  }

  const cityDisabled = disabled || !province || isForeign || cityOpts.length === 0;

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">省份 *</label>
        <select
          value={province}
          disabled={disabled}
          onChange={(e) => onChange({ province: e.target.value, city: "" })}
          className={baseCls}
        >
          <option value="">请选择省份</option>
          {provinceOpts.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">城市</label>
        <select
          value={city}
          disabled={cityDisabled}
          onChange={(e) => onChange({ province, city: e.target.value })}
          className={baseCls}
        >
          <option value="">
            {isForeign
              ? "国外无需城市"
              : cityOpts.length === 0
              ? "整省 / 直辖市"
              : "请选择城市"}
          </option>
          {cityOpts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
