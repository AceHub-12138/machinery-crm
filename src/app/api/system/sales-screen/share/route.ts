import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";
import {
  createOrRotateSalesScreenShare,
  readSalesScreenShare,
  revokeSalesScreenShare,
} from "@/modules/screen/share-service";

// 响应只包含相对路径；不读取 Host、Origin、Forwarded 等请求头，绝不构造绝对 URL
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await readSalesScreenShare(user));
  } catch (error) {
    return NextResponse.json({ error: isDomainError(error) ? error.message : "共享链接操作失败" }, { status: isDomainError(error) ? error.status : 500 });
  }
}

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await createOrRotateSalesScreenShare(user));
  } catch (error) {
    return NextResponse.json({ error: isDomainError(error) ? error.message : "共享链接操作失败" }, { status: isDomainError(error) ? error.status : 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await revokeSalesScreenShare(user));
  } catch (error) {
    return NextResponse.json({ error: isDomainError(error) ? error.message : "共享链接操作失败" }, { status: isDomainError(error) ? error.status : 500 });
  }
}
