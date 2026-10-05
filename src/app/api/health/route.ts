import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
let probe: Promise<boolean> | null = null;
let checkedAt = 0;
let probing = false;

/** 共享短期探测结果，避免公开探活接口被高频调用耗尽数据库连接池。 */
export async function GET() {
  if (!probe || !probing && Date.now() - checkedAt > 5_000) {
    probing = true;
    probe = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      return true;
    }, { maxWait: 1_000, timeout: 3_000 }).catch(() => false).finally(() => {
      probing = false;
      checkedAt = Date.now();
    });
  }
  const healthy = await probe;
  return NextResponse.json({ status: healthy ? "ok" : "degraded" }, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
