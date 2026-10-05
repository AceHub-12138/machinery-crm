import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";
import { searchAuditLogs } from "@/modules/system/audit/service";
export async function GET(request: NextRequest) { try { const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 }); return NextResponse.json(await searchAuditLogs(user, new URL(request.url).searchParams)); } catch (error) { return NextResponse.json({ error: isDomainError(error) ? error.message : "操作日志加载失败" }, { status: isDomainError(error) ? error.status : 500 }); } }
