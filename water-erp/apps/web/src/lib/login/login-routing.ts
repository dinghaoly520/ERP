import type { AuthRole } from "@/lib/api/auth";

const POST_LOGIN_DESTINATIONS: Record<string, string> = {
  admin: "/dashboard",
  bid_host: "/dashboard",
  procurement_staff: "/procurements",
  bid_expert: "/procurements",
  supplier: "/procurements",
  mall: "/procurements",
};

const SWDG_USERNAME = "SWDG-01";
const SWDG_LOGIN_DESTINATION = "/tender-write";

export function getPostLoginDestination(role: string, username?: string) {
  if (username === SWDG_USERNAME) {
    return SWDG_LOGIN_DESTINATION;
  }
  return POST_LOGIN_DESTINATIONS[role] ?? "/work-arrangements";
}

/** 有权限访问数据管理页面的角色 */
const DATABASE_ACCESS_ROLES: ReadonlySet<string> = new Set<AuthRole>([
  "admin",
  "bid_host",
  "procurement_staff",
]);

export function canAccessDatabase(role: string) {
  return DATABASE_ACCESS_ROLES.has(role as AuthRole);
}

// Map user settings home page to route
const HOME_PAGE_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  procurements: "/procurements",
  projects: "/projects",
  "work-arrangements": "/work-arrangements",
};

export function getHomePageRoute(homePage: string): string {
  return HOME_PAGE_ROUTES[homePage] ?? "/dashboard";
}
