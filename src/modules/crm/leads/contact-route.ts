import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/permissions";
import { DomainError, isDomainError } from "@/modules/shared/domain-error";
import { requireContactAdmin } from "./contact-lookup";
export async function contactAdminRoute(action: (user: SessionUser, signal: AbortSignal) => Promise<unknown>) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DomainError("反查请求超时，请刷新状态后重试", 504)); }, 24_000); });
    const work = async () => {
      const user = await getSessionUser();
      requireContactAdmin(user);
      controller.signal.throwIfAborted();
      return action(user!, controller.signal);
    };
    return NextResponse.json(await Promise.race([work(), timeout]));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[lead-contact] 请求失败", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "联系方式核验失败，请重试" }, { status: 500 });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
