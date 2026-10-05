import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/permissions";
import { search } from "@/modules/global-search/service";
import type { SearchResultType } from "@/modules/global-search/types";
import { isDomainError } from "@/modules/shared/domain-error";

const SEARCH_RESULT_TYPES = new Set<SearchResultType>([
  "nav",
  "customer",
  "contract",
  "product",
  "material",
  "purchase-order",
  "production-order",
  "after-sales-order",
]);

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedType = searchParams.get("type");

    if (requestedType && !SEARCH_RESULT_TYPES.has(requestedType as SearchResultType)) {
      return NextResponse.json({ results: [] });
    }

    return NextResponse.json(await search(
      searchParams.get("q") || "",
      user,
      requestedType as SearchResultType | undefined,
    ));
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[search.GET]", error);
    return NextResponse.json({ error: "全局搜索失败" }, { status: 500 });
  }
}
