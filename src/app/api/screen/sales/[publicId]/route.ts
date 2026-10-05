import { NextRequest, NextResponse } from "next/server";
import { isDomainError } from "@/modules/shared/domain-error";
import { getPublicSalesScreenPayload } from "@/modules/screen/public-service";

// 公开响应统一禁缓存并禁止搜索引擎收录
const PUBLIC_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params;
    const payload = await getPublicSalesScreenPayload(publicId);
    return NextResponse.json(payload, { headers: PUBLIC_HEADERS });
  } catch (error) {
    // 失效、撤销、配置关闭或标识错误统一表现为「大屏不可用」；
    // 仅公开不可用门（DomainError 404）映射为 404，其余任何错误
    // 只返回通用 500，不把内部故障伪装成链接失效，也不输出堆栈、数据库信息或配置。
    if (isDomainError(error) && error.status === 404) {
      return NextResponse.json({ error: "大屏不可用" }, { status: 404, headers: PUBLIC_HEADERS });
    }
    return NextResponse.json({ error: "大屏暂时不可用" }, { status: 500, headers: PUBLIC_HEADERS });
  }
}
