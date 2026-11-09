import { Request } from 'express';
import { PORTS, portalFromHostname, type AppName } from '@water-erp/config';

/**
 * 每个门户独立登录会话 —— 浏览器在 localhost 上跨端口共享 cookie，
 * 因此用「按门户命名」的 cookie（token_web / token_supplier / token_expert 等）
 * 来隔离各门户的登录态。
 */

/**
 * 角色 → cookie 命名空间所属门户。
 *
 * 命名说明：此映射与 `@water-erp/config` 的 `ROLE_PORTAL`（角色 → 登录后落地门户）
 * 语义不同——这里关心的是「该角色的登录 cookie 存在哪个命名空间」。
 * X-P3-05（2026-09-29 注释更正，随 X-P1-01 修复后的现实）：本表是「web 入口登录」的
 * 命名空间口径——admin 从 :3005 登录写 token_web（账号管理在 :3005）、bid_host 恒
 * token_bid；admin 从非 web 门户登录时 auth.controller 按 ROLE_PORTAL 落地改写 token_bid
 * （否则 bid-portal 只读 token_bid 会落地即 401）。「admin/bid_host 共用 token_web」
 * 的旧说法已过时。为避免与 config 端同名常量混淆，特此改名。
 */
export const ROLE_COOKIE_PORTAL: Record<string, string> = {
  admin: 'web',
  bid_host: 'bid',
  leader: 'web',
  staff: 'web',
  supplier: 'supplier',
  bid_expert: 'expert',
};

/**
 * 本地端口 → 门户名。由 @water-erp/config 的 PORTS 派生，端口重分配后无需手动同步。
 *
 * 仅收录「持有登录 cookie」的门户：assistant(:3008) 公开无 cookie、api(:4001) 是服务端自身，故排除。
 * bid-portal(:3007) 使用独立的 token_bid 命名空间（auth port-roles 体系：
 * :3006 登录分流时非 bid_expert 角色写 token_bid 后跳 :3007）。
 */
const COOKIE_PORTALS: AppName[] = ['public', 'supplier', 'web', 'expert', 'bid'];
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
 * 域名家族（*.scsfjt.com）hostname → cookie 命名空间门户。
 *
 * - mobile-portal（:3011）会话复用 token_web 命名空间（其 proxy 自报 `X-Portal: web`），
 *   直链导航时同口径落 web；
 * - api 子域是服务端自身、非登录门户 → 无映射（落 undefined，回退旧版 token cookie）。
 */
const HOSTNAME_PORTAL: Partial<Record<AppName, string>> = {
  public: 'public',
  supplier: 'supplier',
  web: 'web',
  expert: 'expert',
  bid: 'bid',
  mobile: 'web',
};

/**
 * 从请求中判断来源门户：优先读 `X-Portal` 请求头，
 * 其次从 Origin / Referer 的端口推断（dev 端口模式），
 * 再按域名家族子域反查（生产 *.scsfjt.com 无端口，2026-11-09），均失败返回 undefined。
 *
 * 域名子域回退镜像 WS 握手 `portalFromHandshake` 的同款收口。触发场景：门户页
 * `<a href="/api/...">` 直链下载/预览（next.config rewrites 与门户 nginx 反代均不注入
 * X-Portal，浏览器 GET 导航不带 Origin、仅无端口 Referer）——无此回退则取不到
 * 按门户命名的 cookie、回退旧版 token → 401「未登录或登录已过期」
 * （2026-11-09 生产实录：专家门户「标书获取」预览谈判采购文件）。
 * 安全口径与 WS 端一致：门户值仅作 cookie 名选择器（伪造只能选用自己浏览器里
 * 已有的 cookie），JWT 校验照旧强制，无提权面。
 */
export function portalFromRequest(req: Request): string | undefined {
  const header = req.headers['x-portal'] as string | undefined;
  if (header) return header;

  const origin = req.headers['origin'] as string | undefined;
  const referer = req.headers['referer'] as string | undefined;
  const ref = origin || referer;
  if (ref) {
    try {
      const u = new URL(ref);
      if (u.port && PORT_TO_PORTAL[u.port]) return PORT_TO_PORTAL[u.port];
      const hostPortal = portalFromHostname(u.hostname);
      if (hostPortal) return HOSTNAME_PORTAL[hostPortal];
    } catch {
      /* ignore malformed header */
    }
  }
  return undefined;
}

/**
 * 读取当前请求应使用的鉴权 token。
 * 优先级：tab 级会话头（X-Web-Token / X-Supplier-Token）→ 按门户命名 cookie → 旧版 token。
 *
 * X-Web-Token（2026-08-21，:3005 单设备登录配套）：token_web cookie 在同一浏览器
 * 全局只有一份——两个标签页登录两个账号时会互相覆盖，先登录的标签页拿到的已是
 * 他人 cookie。登录后前端把 access_token 存进 sessionStorage（各标签页独立），
 * 请求经此头携带自己的 token，同浏览器多账号并存；cookie 仅作回退
 * （无头客户端 / SSR / 关闭标签页后重开）。
 *
 * X-Supplier-Token（2026-09-28，:3004 同款移植）：token_supplier cookie 同样浏览器全局
 * 一份，同浏览器另一标签页登录会把旧标签页无感顶成新会话——旧标签页改带本 tab 的
 * token 后，sid 比对不通过即 401 SESSION_REPLACED，实现「点登录才顶、被顶有感知」。
 */
export function tokenFromRequest(req: Request): string | undefined {
  const headerToken = (req.headers['x-web-token'] ?? req.headers['x-supplier-token']) as string | undefined;
  if (headerToken) return headerToken;
  const portal = portalFromRequest(req);
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (portal && cookies && cookies[cookieNameForPortal(portal)]) {
    return cookies[cookieNameForPortal(portal)];
  }
  return cookies?.[LEGACY_COOKIE] as string | undefined;
}
