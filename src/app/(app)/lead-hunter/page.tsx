import { redirect } from "next/navigation";
import { requireAuth, isSuperAdmin } from "@/lib/permissions";
import { LeadHunterClient } from "@/components/lead-hunter/lead-hunter-client";

export const dynamic = "force-dynamic";

/** 获客助手：仅超级管理员（middleware 已拦一层，这里再校验一次） */
export default async function LeadHunterPage() {
  const user = await requireAuth();
  if (!isSuperAdmin(user)) redirect("/dashboard");
  return <LeadHunterClient />;
}
