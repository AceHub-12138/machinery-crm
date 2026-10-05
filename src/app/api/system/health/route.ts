import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";
import { getSystemHealth } from "@/modules/system/health/service";

export async function GET() { try { const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 }); return NextResponse.json(await getSystemHealth(user)); } catch (error) { return NextResponse.json({ error: isDomainError(error) ? error.message : "健康检查失败" }, { status: isDomainError(error) ? error.status : 500 }); } }
