import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getDesktopDownloadDir } from "@/lib/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 公开端点：桌面客户端最新版本信息。
 * 数据源是下载目录里的 latest.yml（electron-updater 的版本清单）——桌面端发新版
 * 只需把 exe/blockmap/latest.yml 三个文件传到服务器，平台无需跟着发版。
 * latest.yml 是 electron-builder 生成的扁平结构，用行级解析即可，不引入 yaml 依赖。
 */
export async function GET() {
  const ymlPath = path.join(getDesktopDownloadDir(), "latest.yml");
  try {
    const raw = fs.readFileSync(ymlPath, "utf8");
    const pick = (key: string) => {
      const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(raw);
      return match ? match[1].replace(/^['"]|['"]$/g, "") : null;
    };
    const version = pick("version");
    const file = pick("path") || pick("url");
    if (!version || !file) {
      return NextResponse.json({ available: false, error: "latest.yml 内容不完整" }, { status: 500 });
    }
    const sizeMatch = /size:\s*(\d+)/.exec(raw);
    return NextResponse.json(
      {
        available: true as const,
        version,
        fileName: file,
        file: `/api/downloads/desktop/${file.split("/").map(encodeURIComponent).join("/")}`,
        releaseDate: pick("releaseDate"),
        size: sizeMatch ? Number(sizeMatch[1]) : null,
      },
      { headers: { "Cache-Control": "no-cache" } },
    );
  } catch {
    return NextResponse.json(
      { available: false as const, error: "暂未发布桌面客户端" },
      { status: 404 },
    );
  }
}
