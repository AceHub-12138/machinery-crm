import { NextRequest, NextResponse } from "next/server";
import { createCustomer, isDuplicateCustomerError, listCustomers } from "@/modules/crm/customers/service";
import { isDomainError } from "@/modules/shared/domain-error";
import { getSessionUser } from "@/lib/permissions";

/** 兼容 CRM 客户入口；领域规则只保留在 customers service。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await listCustomers(user, new URL(request.url).searchParams));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[customers.GET]", error);
    return NextResponse.json({ error: "客户列表加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await createCustomer(user, await request.json()), { status: 201 });
  } catch (error) {
    console.error("[customers.POST]", error);
    if (isDomainError(error)) {
      if (error.status === 409) return NextResponse.json({ warning: true, message: error.message, ...error.details }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isDuplicateCustomerError(error)) return NextResponse.json({ error: "客户唯一字段重复，请检查公司名称、电话、邮箱或 WhatsApp" }, { status: 409 });
    return NextResponse.json({ error: "创建客户失败" }, { status: 400 });
  }
}
