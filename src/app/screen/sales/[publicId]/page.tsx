import type { Metadata } from "next";
import { isDomainError } from "@/modules/shared/domain-error";
import { getPublicSalesScreenPayload } from "@/modules/screen/public-service";
import { parseScreenSearchParams } from "@/modules/screen/sales-screen-layout";
import { SalesScreenBoard } from "@/components/screen/SalesScreenBoard";
import { SalesScreenUnavailable } from "@/components/screen/SalesScreenUnavailable";
import type { PublicSalesScreenPayload } from "@/modules/screen/public-types";

// 大屏必须每次请求实时取得公开 payload；构建阶段绝不访问数据库
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 公开大屏对搜索引擎不可见（响应头另有 X-Robots-Tag 兜底）
export const metadata: Metadata = {
  title: "大川经营指挥舱",
  robots: { index: false, follow: false },
};

/**
 * 展厅大屏入口（Server Component）。
 *
 * 直接调用公开数据服务取得 payload，首屏 HTML 即包含真实经营内容，
 * 不经过内部 HTTP、不依赖登录 Session；publicId 只从动态路由参数取得。
 * 无效/撤销/关闭的链接与未知异常分别降级为两种安全文案，不泄露内部细节。
 */
export default async function SalesScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const { kiosk, fit } = parseScreenSearchParams(await searchParams);

  // 先在 try 内取数，再在 try 外渲染，避免在 catch 语义里构造 JSX
  let payload: PublicSalesScreenPayload;
  try {
    payload = await getPublicSalesScreenPayload(publicId);
  } catch (error) {
    // 公开不可用门（链接失效/撤销/关闭）与其余未知异常分开呈现，
    // 但同样不输出任何原因或内部细节
    if (isDomainError(error) && error.status === 404) {
      return <SalesScreenUnavailable />;
    }
    return <SalesScreenUnavailable temporary />;
  }

  return <SalesScreenBoard initialPayload={payload} publicId={publicId} kiosk={kiosk} initialFit={fit} />;
}
