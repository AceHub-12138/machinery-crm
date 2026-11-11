import { NextRequest } from "next/server";
import { confirmLeadContact } from "@/modules/crm/leads/contact-lookup";
import { contactAdminRoute } from "@/modules/crm/leads/contact-route";
export async function POST(request: NextRequest, { params }: { params: Promise<{ lookupId: string }> }) {
  return contactAdminRoute(async (user) => confirmLeadContact(user, (await params).lookupId, await request.json().catch(() => null)));
}
