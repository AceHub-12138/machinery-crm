import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";

// 大川机床 CRM —— 天地图瓦片服务器中转
// 浏览器请求 /api/map/tile?layer=vec&z=&x=&y= ，由服务器带密钥去天地图取瓦片再返回。
// 好处：所有天地图请求都从服务器发出，"服务器端密钥 + IP白名单" 即可授权；密钥不暴露在浏览器。

const SUBS = ["0", "1", "2", "3", "4", "5", "6", "7"];

function getKey() {
  return (
    process.env.TIANDITU_KEY ||
    process.env.TIANDITU_WEB_KEY ||
    process.env.NEXT_PUBLIC_TIANDITU_KEY ||
    ""
  ).trim();
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = getKey();
  if (!key) {
    return new NextResponse("TIANDITU_KEY 未配置", { status: 500 });
  }

  const sp = request.nextUrl.searchParams;
  const layer = sp.get("layer") === "cva" ? "cva" : "vec";
  const z = sp.get("z");
  const x = sp.get("x");
  const y = sp.get("y");

  if (z == null || x == null || y == null) {
    return new NextResponse("缺少瓦片参数", { status: 400 });
  }

  const s = SUBS[Math.abs(Number(x) + Number(y)) % SUBS.length];
  const url =
    `https://t${s}.tianditu.gov.cn/${layer}_w/wmts?` +
    `SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}` +
    `&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
    `&TILEMATRIX=${encodeURIComponent(z)}&TILEROW=${encodeURIComponent(y)}&TILECOL=${encodeURIComponent(x)}` +
    `&tk=${encodeURIComponent(key)}`;

  try {
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) {
      return new NextResponse(`天地图瓦片返回 ${upstream.status}`, { status: upstream.status });
    }
    const contentType = upstream.headers.get("content-type") || "";
    // 天地图鉴权失败时会返回一段文字/JSON 而不是图片，识别出来给前端更清晰的提示
    if (!contentType.startsWith("image")) {
      const text = await upstream.text();
      return new NextResponse(`天地图授权失败：${text.slice(0, 200)}`, { status: 403 });
    }
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || "image/png",
        // 瓦片可缓存，减少对天地图的重复请求与配额消耗
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (error) {
    return new NextResponse(
      `瓦片中转失败：${error instanceof Error ? error.message : "未知错误"}`,
      { status: 502 }
    );
  }
}
