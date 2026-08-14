import type { AuthRole } from "@/lib/api/auth";
import { getWorkbenchProfile } from "@/lib/workbench-profiles";

const POST_LOGIN_DESTINATIONS: Record<string, string> = {
  admin: "/dashboard",
  bid_host: "/dashboard",
  bid_expert: "/procurements",
  supplier: "/procurements",
  mall: "/procurements",
};

export function getPostLoginDestination(role: string, username?: string) {
  // 个性化工作台配置（如 SWDG-01 落地 /tender-write）优先于角色默认
  return getWorkbenchProfile(username)?.landingPath ?? POST_LOGIN_DESTINATIONS[role] ?? "/work-arrangements";
}

/** 有权限访问数据管理页面的角色 */
const DATABASE_ACCESS_ROLES: ReadonlySet<string> = new Set<AuthRole>([
  "admin",
  "leader",
  "staff",
  "bid_host",
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
