import { PORTS, type AppName } from './ports';

/** API 服务 origin —— 各门户 next.config rewrites / middleware 代理目标的唯一来源。
 *  环境变量 API_ORIGIN 可覆盖（生产指向真实后端域名）；默认本地端口（PORTS.api）。
 *  2026-08 审计 D：此前 7 个 next.config + vite + proxy.ts 各自硬编码 localhost:4001。 */
export function apiOrigin(): string {
  return (process.env.API_ORIGIN || `http://localhost:${PORTS.api}`).replace(/\/+$/, '');
}

/** 门户 origin（无路径、无尾斜杠）—— 后端生成跨门户跳转/白名单的兜底值。
 *  env 覆盖优先（如 EXPERT_PORTAL_URL / SUPPLIER_PORTAL_URL），未设用本地端口。 */
export function portalOrigin(app: AppName, envOverride?: string): string {
  return (envOverride || `http://localhost:${PORTS[app]}`).replace(/\/+$/, '');
}

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
