import { PORTS, type AppName } from './ports';
import { PORTAL_DOMAINS, inDomainFamily } from './domains';

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

/** 构建门户完整 URL（浏览器端使用）。
 *  双轨自适应（2026-10-26，子域名申请单 2026-10-14 新终版）：当前页经 *.scsfjt.com
 *  域名访问且目标门户有子域 → 同协议域名跳转（不带端口）；端口/IP 访问（localhost、
 *  局域网/公网 IP）或目标无子域（assistant/bigscreen）→ 端口口径不变。 */
export function portalURL(app: AppName, path = '/'): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const domain = PORTAL_DOMAINS[app];
    if (domain && inDomainFamily(window.location.hostname)) {
      return `${window.location.protocol}//${domain}${cleanPath}`;
    }
    const port = PORTS[app];
    return `http://${window.location.hostname}:${port}${cleanPath}`;
  }
  // SSR: 返回占位值，实际 href 由客户端 hydrate 后覆盖。
  // 避免 SSR/客户端 hostname 不一致（localhost vs LAN IP）触发 hydration mismatch。
  return `http://localhost:${PORTS[app]}${cleanPath}`;
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
};

/**
 * socket.io 网关统一寻址（2026-11-03 上收，6 消费点共用：通知 / 开标×4 / 聊天）。
 * namespace 作参数（如 '/notifications'、'/bid'、'/chat'）。
 *
 * 拓扑口径（生产前后端分离：浏览器只可达门户域，门户→后端仅开 API 端口，
 * api 子域对浏览器不可达——2026-11-03 用户澄清）：
 * - 域名模式 → **同源** `${origin}${namespace}`。socket.io 的 URI pathname=命名空间、
 *   wire path 恒为 /socket.io/——由门户侧 nginx 将 /socket.io/ 反代到 API 端口（带
 *   WS 升级头，一个 location 服务全部命名空间）；同源免 CORS、cookie 天然携带。
 *   旧病根：同源写 `/api/<ns>` 会让命名空间错位（实测 Invalid namespace）；指 api
 *   子域则在分离拓扑下不可达。
 * - 端口/IP 模式（开发/LAN）→ 直连当前主机:4001（按访问主机自适应，
 *   2026-10-09 局域网缺口口径）。
 * 须在浏览器端调用（读 window.location）；SSR 无 window 兜底 localhost。
 */
export function gatewayWsUrl(namespace: string): string {
  const ns = namespace.startsWith('/') ? namespace : `/${namespace}`;
  if (typeof window !== 'undefined') {
    if (inDomainFamily(window.location.hostname)) {
      const origin = window.location.origin || `${window.location.protocol}//${window.location.hostname}`;
      return `${origin}${ns}`;
    }
    return `${window.location.protocol}//${window.location.hostname}:${PORTS.api}${ns}`;
  }
  return `http://localhost:${PORTS.api}${ns}`;
}

/**
 * 通知网关 WS 地址（X-P3-03 2026-09-29 上收——四门户 realtime-notifications 原样四份复制）：
 * NEXT_PUBLIC_WS_URL 覆盖（去尾斜杠）——⚠️ 历史逃生口，勿随意设置：该变量曾同时被
 * 四门户 use-bid-websocket 消费（现 hooks 已改走 gatewayWsUrl 不再读它）。
 * 默认走 gatewayWsUrl('/notifications')（同源/直连双模，见其注释）。
 */
export function notificationWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, '');
  return gatewayWsUrl('/notifications');
}

/** 获取指定角色登陆后应跳转的完整门户 URL */
export function landingURL(role: string): string {
  const app = ROLE_PORTAL[role] || 'public';
  const path = ROLE_LANDING[role] || '/';
  return portalURL(app, path);
}
