import { PORTS, type AppName } from './ports';

/** 构建门户完整 URL（浏览器端使用） */
export function portalURL(app: AppName, path = '/'): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const port = PORTS[app];
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `http://${host}:${port}${cleanPath}`;
}

/** 角色 → 登陆后跳转路径 */
export const ROLE_LANDING: Record<string, string> = {
  admin: '/dashboard',
  bid_host: '/dashboard',
  procurement_staff: '/dashboard',
  supplier: '/dashboard',
  bid_expert: '/',
};

/** 角色 → 目标门户 */
export const ROLE_PORTAL: Record<string, AppName> = {
  admin: 'web',
  bid_host: 'web',
  procurement_staff: 'web',
  supplier: 'supplier',
  bid_expert: 'expert',
};

/** 获取指定角色登陆后应跳转的完整门户 URL */
export function landingURL(role: string): string {
  const app = ROLE_PORTAL[role] || 'public';
  const path = ROLE_LANDING[role] || '/';
  return portalURL(app, path);
}
