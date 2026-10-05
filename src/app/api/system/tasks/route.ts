import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";
import { listUnifiedTasks, updateTaskState } from "@/modules/system/tasks/service";

export async function GET(request: NextRequest) { try { const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 }); return NextResponse.json({ items: await listUnifiedTasks(user, new URL(request.url).searchParams.get("view") || "inbox") }); } catch (error) { return NextResponse.json({ error: isDomainError(error) ? error.message : "待办加载失败" }, { status: isDomainError(error) ? error.status : 500 }); } }
export async function PATCH(request: NextRequest) { try { const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 }); const body = await request.json(); return NextResponse.json(await updateTaskState(user, body)); } catch (error) { return NextResponse.json({ error: isDomainError(error) ? error.message : "待办状态更新失败" }, { status: isDomainError(error) ? error.status : 500 }); } }
