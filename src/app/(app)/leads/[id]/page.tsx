import { LeadDetailClient } from "@/components/leads/lead-detail-client";
import { requireLeadPoolPageUser } from "@/modules/crm/leads/page-access";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireLeadPoolPageUser();
  const { id } = await params;
  return <LeadDetailClient canAssign={user.role === "SUPER_ADMIN"} leadId={id} />;
}
