/**
 * 中国省级行政区地图中心点坐标
 */

type ProvinceCenter = {
  lat: number;
  lng: number;
};

const PROVINCE_CENTERS: Record<string, ProvinceCenter> = {
  // 省
  "河北省": { lat: 38.05, lng: 114.48 },
  "山西省": { lat: 37.87, lng: 112.53 },
  "辽宁省": { lat: 41.80, lng: 123.43 },
  "吉林省": { lat: 43.88, lng: 125.35 },
  "黑龙江省": { lat: 45.75, lng: 126.63 },
  "江苏省": { lat: 32.04, lng: 118.78 },
  "浙江省": { lat: 30.27, lng: 120.15 },
  "安徽省": { lat: 31.86, lng: 117.27 },
  "福建省": { lat: 26.08, lng: 119.30 },
  "江西省": { lat: 28.68, lng: 115.89 },
  "山东省": { lat: 36.65, lng: 117.12 },
  "河南省": { lat: 34.76, lng: 113.65 },
  "湖北省": { lat: 30.59, lng: 114.30 },
  "湖南省": { lat: 28.23, lng: 112.94 },
  "广东省": { lat: 23.13, lng: 113.26 },
  "海南省": { lat: 20.02, lng: 110.33 },
  "四川省": { lat: 30.67, lng: 104.06 },
  "贵州省": { lat: 26.58, lng: 106.71 },
  "云南省": { lat: 25.04, lng: 102.71 },
  "陕西省": { lat: 34.27, lng: 108.95 },
  "甘肃省": { lat: 36.06, lng: 103.83 },
  "青海省": { lat: 36.62, lng: 101.78 },

  // 注：标准名单（PROVINCE_CITY_MAP）不含台湾省与港澳特别行政区（该客户域归入"国外"），
  // 因此本表不收录，避免出现校验无法到达的死数据。

  // 自治区
  "内蒙古自治区": { lat: 40.82, lng: 111.65 },
  "广西壮族自治区": { lat: 22.82, lng: 108.32 },
  "西藏自治区": { lat: 29.65, lng: 91.13 },
  "宁夏回族自治区": { lat: 38.47, lng: 106.27 },
  "新疆维吾尔自治区": { lat: 43.79, lng: 87.63 },

  // 直辖市
  "北京市": { lat: 39.90, lng: 116.41 },
  "天津市": { lat: 39.13, lng: 117.20 },
  "上海市": { lat: 31.23, lng: 121.47 },
  "重庆市": { lat: 29.56, lng: 106.55 },
};

/**
 * 获取省级行政区中心点坐标
 * 名称校验不在本模块（唯一标准源为 src/lib/region-data.ts），本模块只负责坐标；
 * 仅识别自有属性键，原型链键（toString/constructor/__proto__ 等）一律返回 null
 * @param province 省级行政区名称
 * @returns 中心点坐标，如果省份不存在则返回 null
 */
export function getProvinceCenter(province: string): ProvinceCenter | null {
  if (!province || typeof province !== "string") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(PROVINCE_CENTERS, province)) {
    return null;
  }
  return PROVINCE_CENTERS[province];
}
