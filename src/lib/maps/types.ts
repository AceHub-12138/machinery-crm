export type MapPoint = {
  lng: number;
  lat: number;
  address: string;
  name?: string;
};

export type ShipmentMapDestination = {
  id: string;
  address: string;
  location?: MapPoint;
  error?: string;
  // 兼容旧字段名（高德时期），天地图下不再使用，保留以免其它代码报错
  amapInfo?: string;
  amapInfocode?: string;
};

export type ShipmentMapGeocodeResponse = {
  ok: boolean;
  error?: string;
  failedAddress?: string;
  origin: MapPoint | null;
  destinations: ShipmentMapDestination[];
  resolvedCount?: number;
  skippedCount?: number;
};

export const FACTORY_ADDRESS = "山东省滕州市经济开发区兴滕东路";
export const FACTORY_NAME = "大川机床滕州工厂";
