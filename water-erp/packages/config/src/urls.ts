import { PORTS, type AppName } from './ports';

/** 构建门户完整 URL（浏览器端使用） */
export function portalURL(app: AppName, path = '/'): string {
  const port = PORTS[app];
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:${port}${cleanPath}`;
  }
  // SSR: 返回占位值，实际 href 由客户端 hydrate 后覆盖。
  // 避免 SSR/客户端 hostname 不一致（localhost vs LAN IP）触发 hydration mismatch。
  return `http://localhost:${port}${cleanPath}`;
}

/** 角色 → 登陆后跳转路径 */
export const ROLE_LANDING: Record<string, string> = {
  admin: '/bid',
  bid_host: '/bid',
  supplier: '/dashboard',
  bid_expert: '/',
};

/** 角色 → 目标门户 */
export const ROLE_PORTAL: Record<string, AppName> = {
  admin: 'bid',
  bid_host: 'bid',
  supplier: 'supplier',
  bid_expert: 'expert',
  mall: 'mall',
};

/** 获取指定角色登陆后应跳转的完整门户 URL */
export function landingURL(role: string): string {
  const app = ROLE_PORTAL[role] || 'public';
  const path = ROLE_LANDING[role] || '/';
  return portalURL(app, path);
}
