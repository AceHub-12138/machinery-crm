import { getLookupQuota } from "@/modules/crm/leads/contact-lookup";
import { contactAdminRoute } from "@/modules/crm/leads/contact-route";
export async function GET() { return contactAdminRoute((user) => getLookupQuota(user)); }
