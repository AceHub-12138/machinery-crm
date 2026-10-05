import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";
import { listSettings, saveSetting } from "@/modules/system/settings/service";

export async function GET() { try { const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 }); return NextResponse.json(await listSettings(user)); } catch (error) { return NextResponse.json({ error: isDomainError(error) ? error.message : "配置加载失败" }, { status: isDomainError(error) ? error.status : 500 }); } }
export async function PUT(request: NextRequest) { try { const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 }); const body = await request.json(); return NextResponse.json(await saveSetting(user, String(body.key || ""), body.value)); } catch (error) { return NextResponse.json({ error: isDomainError(error) ? error.message : "配置保存失败" }, { status: isDomainError(error) ? error.status : 500 }); } }
