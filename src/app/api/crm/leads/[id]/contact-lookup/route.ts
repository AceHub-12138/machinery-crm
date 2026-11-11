import { NextRequest } from "next/server";
import { lookupLeadContact } from "@/modules/crm/leads/contact-lookup";
import { contactAdminRoute } from "@/modules/crm/leads/contact-route";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return contactAdminRoute(async (user, signal) => lookupLeadContact(user, (await params).id, await request.json().catch(() => ({})), { signal }));
}
