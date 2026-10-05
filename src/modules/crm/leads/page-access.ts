import { redirect } from "next/navigation";
import { dashboardHomeForRole } from "@/lib/dashboard-access";
import { getSessionUser } from "@/lib/permissions";
import { leadVisibilityWhere } from "@/modules/crm/leads/access";

export async function requireLeadPoolPageUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  try {
    leadVisibilityWhere(user);
  } catch {
    redirect(dashboardHomeForRole(user.role) || "/login");
  }
  return user;
}
