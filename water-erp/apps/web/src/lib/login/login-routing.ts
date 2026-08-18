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

/** 有权限访问驾驶舱页面（/dashboard 数据库）的角色——仅管理权限（leader/admin） */
const DATABASE_ACCESS_ROLES: ReadonlySet<string> = new Set<AuthRole>([
  "admin",
  "leader",
]);

export function canAccessDatabase(role: string) {
  return DATABASE_ACCESS_ROLES.has(role as AuthRole);
}

/** 驾驶舱整组页面（数据库/采购台账/采购进度）——仅管理权限（leader/admin） */
export function canAccessCockpit(role: string) {
  return canAccessDatabase(role);
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
