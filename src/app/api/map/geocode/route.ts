import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import {
  FACTORY_ADDRESS,
  FACTORY_NAME,
  type MapPoint,
  type ShipmentMapDestination,
  type ShipmentMapGeocodeResponse,
} from "@/lib/maps/types";

// 大川机床 CRM —— 发货地址解析接口（天地图版，带内存缓存 + 并发限流）
// 天地图返回 CGCS2000(≈WGS84) 坐标，与天地图底图一致，无坐标偏移。
// 缓存：同一地址在服务器进程存活期间只解析一次，之后秒返回、不再消耗天地图配额。

type GeocodeInput = { id: string; address: string };
type GeocodeResult = { point: MapPoint | null; error?: string };

const geoCache = new Map<string, MapPoint>();
const MAX_DESTINATIONS = 80;
const CONCURRENCY = 6;

function getTiandituKey() {
  return (
    process.env.TIANDITU_KEY ||
    process.env.TIANDITU_WEB_KEY ||
    process.env.NEXT_PUBLIC_TIANDITU_KEY ||
    ""
  ).trim();
}

function json(payload: ShipmentMapGeocodeResponse, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

function normalizeAddress(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function geocode(address: string, key: string): Promise<GeocodeResult> {
  const normalizedAddress = normalizeAddress(address);

  if (!key) {
    return { point: null, error: "TIANDITU_KEY 未配置，请先在 .env 中配置天地图密钥(tk)" };
  }
  if (!normalizedAddress) {
    return { point: null, error: "地址为空，无法解析" };
  }

  const cached = geoCache.get(normalizedAddress);
  if (cached) {
    return { point: { ...cached, address: normalizedAddress } };
  }

  const ds = JSON.stringify({ keyWord: normalizedAddress });
  const url = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(ds)}&tk=${encodeURIComponent(key)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { point: null, error: `天地图地理编码接口请求失败（HTTP ${response.status}）` };
    }

    const data = await response.json();
    const status = String(data?.status ?? "");
    const location = data?.location;

    if (status !== "0" || !location) {
      const msg = data?.msg || "未返回有效坐标";
      return { point: null, error: `天地图地理编码失败：${msg}` };
    }

    const lng = Number(location.lon);
    const lat = Number(location.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return { point: null, error: "天地图返回的坐标格式无效" };
    }

    const point: MapPoint = { lng, lat, address: normalizedAddress, name: normalizedAddress };
    geoCache.set(normalizedAddress, point);
    return { point };
  } catch {
    // 底层异常消息可能携带带 tk 密钥的完整请求 URL，绝不透传给浏览器
    return { point: null, error: "地理编码请求异常" };
  }
}

async function geocodeAll(items: GeocodeInput[], key: string): Promise<ShipmentMapDestination[]> {
  const results: ShipmentMapDestination[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      const address = normalizeAddress(item?.address);
      const id = String(item?.id || "");

      if (!id || !address) {
        results[index] = { id, address, error: "缺少收货地址" };
        continue;
      }
      const r = await geocode(address, key);
      results[index] = r.point
        ? { id, address, location: r.point }
        : { id, address, error: r.error || "地址解析失败" };
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const key = getTiandituKey();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { ok: false, error: "请求体不是有效 JSON", origin: null, destinations: [] },
      { status: 400 }
    );
  }

  const destinations = Array.isArray((body as any)?.destinations)
    ? ((body as any).destinations as GeocodeInput[])
    : [];

  const originResult = await geocode(FACTORY_ADDRESS, key);
  const origin = originResult.point;
  if (origin) {
    origin.name = FACTORY_NAME;
  }

  if (!origin) {
    return json({
      ok: false,
      error: originResult.error || "起点地址解析失败",
      failedAddress: FACTORY_ADDRESS,
      origin: null,
      destinations: [],
    });
  }

  const resolved = await geocodeAll(destinations.slice(0, MAX_DESTINATIONS), key);

  const resolvedCount = resolved.filter((d) => Boolean(d.location)).length;
  const skippedCount = resolved.length - resolvedCount;

  return json({
    ok: true,
    origin,
    destinations: resolved,
    resolvedCount,
    skippedCount,
  });
}
