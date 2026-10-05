import { redirect } from "next/navigation";
import { requireAuth, isSuperAdmin } from "@/lib/permissions";
import { AdminAgentManager } from "@/components/admin/agent-manager";

export const dynamic = "force-dynamic";

/** 平台管理 → Agent 管理：仅超级管理员（middleware 已拦一层，这里再校验一次） */
export default async function AdminAgentPage() {
  const user = await requireAuth();
  if (!isSuperAdmin(user)) redirect("/dashboard");
  return <AdminAgentManager />;
}
