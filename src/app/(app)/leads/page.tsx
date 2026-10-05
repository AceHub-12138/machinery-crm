import { LeadListClient } from "@/components/leads/lead-list-client";
import { requireLeadPoolPageUser } from "@/modules/crm/leads/page-access";

export default async function LeadPoolPage() {
  const user = await requireLeadPoolPageUser();
  return <LeadListClient canFilterAssignee={user.role === "SUPER_ADMIN"} />;
}
