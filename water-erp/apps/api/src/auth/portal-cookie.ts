import { Request } from 'express';
import { PORTS, type AppName } from '@water-erp/config';

/**
 * 每个门户独立登录会话 —— 浏览器在 localhost 上跨端口共享 cookie，
 * 因此用「按门户命名」的 cookie（token_web / token_supplier / token_expert / token_mall）
 * 来隔离各门户的登录态。
 */

/**
 * 角色 → cookie 命名空间所属门户。
 *
 * 命名说明：此映射与 `@water-erp/config` 的 `ROLE_PORTAL`（角色 → 登录后落地门户）
 * 语义不同——这里关心的是「该角色的登录 cookie 存在哪个命名空间」。
 * 例如 admin 登录后浏览器跳转到 bid 门户（config.ROLE_PORTAL.admin='bid'），
 * 但其 cookie 写在 token_web 命名空间（admin/bid_host 共用 token_web，无 token_bid）。
 * 故本表把 admin/leader/staff 都映射到 'web'。为避免与 config 端同名常量混淆，特此改名。
 */
export const ROLE_COOKIE_PORTAL: Record<string, string> = {
  admin: 'web',
  bid_host: 'bid',
  leader: 'web',
  staff: 'web',
  supplier: 'supplier',
  bid_expert: 'expert',
  mall: 'mall',
};

/**
 * 本地端口 → 门户名。由 @water-erp/config 的 PORTS 派生，端口重分配后无需手动同步。
 *
 * 仅收录「持有登录 cookie」的门户：assistant(:3008) 公开无 cookie、api(:4001) 是服务端自身，故排除。
 * bid-portal(:3007) 使用独立的 token_bid 命名空间（auth port-roles 体系：
 * :3006 登录分流时非 bid_expert 角色写 token_bid 后跳 :3007）。
 */
const COOKIE_PORTALS: AppName[] = ['public', 'mall', 'supplier', 'web', 'expert', 'bid'];
const PORT_TO_PORTAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const name of COOKIE_PORTALS) map[String(PORTS[name])] = name;
  return map;
})();

/** 直接访问 API（如 Swagger）时使用的旧版 cookie 名 */
export const LEGACY_COOKIE = 'token';

/** 某门户对应的 cookie 名，例如 web → token_web */
export function cookieNameForPortal(portal: string): string {
  return `token_${portal}`;
}

/** 角色对应的门户（找不到时返回 undefined） */
export function portalForRole(role: string | undefined | null): string | undefined {
  return role ? ROLE_COOKIE_PORTAL[role] : undefined;
}

/**
 * 从请求中判断来源门户：优先读 `X-Portal` 请求头，
 * 其次从 Origin / Referer 的端口推断，均失败返回 undefined。
 */
export function portalFromRequest(req: Request): string | undefined {
  const header = req.headers['x-portal'] as string | undefined;
  if (header) return header;

  const origin = req.headers['origin'] as string | undefined;
  const referer = req.headers['referer'] as string | undefined;
  const ref = origin || referer;
  if (ref) {
    try {
      const port = new URL(ref).port;
      if (port && PORT_TO_PORTAL[port]) return PORT_TO_PORTAL[port];
    } catch {
      /* ignore malformed header */
    }
  }
  return undefined;
}

/**
 * 读取当前请求应使用的鉴权 token。
 * 优先级：X-Web-Token 头（tab 级会话）→ 按门户命名 cookie → 旧版 token。
 *
 * X-Web-Token（2026-08-21，:3005 单设备登录配套）：token_web cookie 在同一浏览器
 * 全局只有一份——两个标签页登录两个账号时会互相覆盖，先登录的标签页拿到的已是
 * 他人 cookie。登录后前端把 access_token 存进 sessionStorage（各标签页独立），
 * 请求经此头携带自己的 token，同浏览器多账号并存；cookie 仅作回退
 * （无头客户端 / SSR / 关闭标签页后重开）。
 */
export function tokenFromRequest(req: Request): string | undefined {
  const headerToken = req.headers['x-web-token'] as string | undefined;
  if (headerToken) return headerToken;
  const portal = portalFromRequest(req);
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (portal && cookies && cookies[cookieNameForPortal(portal)]) {
    return cookies[cookieNameForPortal(portal)];
  }
  return cookies?.[LEGACY_COOKIE] as string | undefined;
}
