import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardHome } from "@/components/home/dashboard-home";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { decodeAuthToken } from "@/lib/auth/token";
import { canAccessDatabase } from "@/lib/login/login-routing";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const user = decodeAuthToken(token);

  if (!user) {
    redirect("/login");
  }

  if (!canAccessDatabase(user.role)) {
    redirect("/procurements");
  }

  return <DashboardHome currentUserRole={user.role} />;
}
