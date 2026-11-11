import { NextRequest } from "next/server";
import { listContactLookups } from "@/modules/crm/leads/contact-lookup";
import { contactAdminRoute } from "@/modules/crm/leads/contact-route";
export async function GET(request: NextRequest) {
  return contactAdminRoute((user) => listContactLookups(user, request.nextUrl.searchParams));
}
