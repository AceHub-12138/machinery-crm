import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/permissions";
import { dashboardHomeForRole } from "@/lib/dashboard-access";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const home = dashboardHomeForRole(user.role);
  if (!home) redirect("/login");
  redirect(home);
}
