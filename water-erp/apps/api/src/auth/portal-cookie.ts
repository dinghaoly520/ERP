import { Request } from 'express';

/**
 * 每个门户独立登录会话 —— 浏览器在 localhost 上跨端口共享 cookie，
 * 因此用「按门户命名」的 cookie（token_web / token_supplier / token_expert / token_mall）
 * 来隔离各门户的登录态。
 */

/** 角色 → 所属门户 */
export const ROLE_PORTAL: Record<string, string> = {
  admin: 'web',
  bid_host: 'web',
  procurement_staff: 'web',
  supplier: 'supplier',
  bid_expert: 'expert',
  mall: 'mall',
};

/** 本地端口 → 门户名（与 @water-erp/config 的 PORTS 保持一致） */
const PORT_TO_PORTAL: Record<string, string> = {
  '3002': 'public',    // 信息门户
  '3003': 'mall',      // 采购商城
  '3004': 'supplier',  // 供应商门户
  '3005': 'web',       // 采购管理工作台
  '3006': 'expert',    // 专家门户
  // bid-portal(:3007) 复用 token_web 命名空间：admin/bid_host 的 cookie 即 token_web（无 token_bid），
  // 故从端口推断门户时把 3007 映射到 'web'，使无 X-Portal 头的客户端请求（如 AppShell 的 /auth/me）能读到 token_web。
  '3007': 'web',
};

/** 直接访问 API（如 Swagger）时使用的旧版 cookie 名 */
export const LEGACY_COOKIE = 'token';

/** 某门户对应的 cookie 名，例如 web → token_web */
export function cookieNameForPortal(portal: string): string {
  return `token_${portal}`;
}

/** 角色对应的门户（找不到时返回 undefined） */
export function portalForRole(role: string | undefined | null): string | undefined {
  return role ? ROLE_PORTAL[role] : undefined;
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

/** 读取当前请求应使用的鉴权 token（按门户命名 cookie，回退到旧版 token） */
export function tokenFromRequest(req: Request): string | undefined {
  const portal = portalFromRequest(req);
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (portal && cookies && cookies[cookieNameForPortal(portal)]) {
    return cookies[cookieNameForPortal(portal)];
  }
  return cookies?.[LEGACY_COOKIE] as string | undefined;
}
