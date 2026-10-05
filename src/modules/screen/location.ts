/**
 * 行政区划解析与校验
 *
 * 地址数据来源（第 4 步服务器入口必须遵守）：
 * - 读取 Customer 的标准行政区划字段 `province` / `city`（见 prisma/schema.prisma Customer 模型），
 *   并用 isValidLocation 校验；
 * - `Customer.region` 是"华北/华南/华东"业务区字段，不是地址，绝不能作为省市来源；
 * - resolveLocation 仅作为 province/city 字段出现自由文本合并内容（如历史数据把省市
 *   写在同一字段）时的兜底解析工具。
 *
 * 标准名单唯一来自 src/lib/region-data.ts 的 PROVINCE_CITY_MAP（CRM 全站共用，含
 * "国外"特殊项；直辖市按整省处理）。坐标表（province-centers / city-centers）只负责
 * 中心点坐标，不参与名称校验。所有键检查必须用自有属性判断，防止原型链键绕过。
 */

import { PROVINCE_CITY_MAP } from "@/lib/region-data";

export type ResolvedLocation = {
  province: string;
  city: string | null;
};

/** 自有属性检查：拒绝 toString/constructor/__proto__ 等原型链键 */
function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * 校验省市是否为标准行政区划（转换器的防御性兜底，供服务器入口构造源数据时先行校验）
 * - 省份必须是 PROVINCE_CITY_MAP 的自有属性键；
 * - 整省处理的省级单位（直辖市、"国外"）不接受城市；
 * - 城市必须属于该省份的标准城市列表。
 */
export function isValidLocation(province: string, city: string | null): boolean {
  if (!province || typeof province !== "string" || !hasOwn(PROVINCE_CITY_MAP, province)) {
    return false;
  }
  if (city === null) {
    return true;
  }
  const cities = PROVINCE_CITY_MAP[province];
  if (!Array.isArray(cities) || cities.length === 0) {
    return false;
  }
  return cities.includes(city);
}

/**
 * 把自由文本省市内容解析为省市（仅作 Customer.province/city 自由文本兜底）
 * 失败封闭：省份按标准名称最长前缀匹配（同时覆盖自治区全称），
 * 城市只接受该省份下属标准城市名的最长前缀匹配；
 * 任何拼接在其中的姓名、电话等自由文本都不可能进入结果。
 * 注意：Object.keys 只返回自有属性键，本函数天然不受原型链键影响。
 */
export function resolveLocation(raw: unknown): ResolvedLocation | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const address = raw.trim();
  if (address.length === 0) {
    return null;
  }

  const province = Object.keys(PROVINCE_CITY_MAP)
    .filter((name) => address.startsWith(name))
    .reduce((best, name) => (name.length > best.length ? name : best), "");
  if (!province) {
    return null;
  }

  const remainder = address.slice(province.length);
  const cities = PROVINCE_CITY_MAP[province];

  let city: string | null = null;
  if (remainder.length > 0 && Array.isArray(cities) && cities.length > 0) {
    for (const name of cities) {
      if (remainder.startsWith(name) && (city === null || name.length > city.length)) {
        city = name;
      }
    }
  }

  return { province, city };
}
