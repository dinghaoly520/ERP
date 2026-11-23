import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiLoopbackOrigin } from '@water-erp/config';

const AUTH_COOKIE_NAME = 'token_web';

/** :3011 专用演示门户（2026-11-19 用户裁定）：仅放行 admin 账号（admin/admin123）。
 *  会话仍复用 token_web 命名空间——在 :3005 登录的其他账号拿到的是有效 token_web，
 *  须在门户闸识别身份并拒入（后端零改动，见 spec 2026-10-13-mobile-portal-3011）。 */
/* 手机号登录白名单（2026-11-23 用户裁定）：19981208777/13882199205 短信验证码、13368360619 固定密码；
 * admin 保留给历史会话兼容（新登录页已无账号密码入口）。白名单与账号 find-or-create 在 auth.service。 */
const MOBILE_ALLOWED_USERNAMES = new Set(['admin', '19981208777', '13882199205', '13368360619']);

/** 解 JWT payload 取 username claim（不验签——仅作路由决策；API 侧每请求仍验签，
 *  伪造签名的假 token 最多骗过本闸进入页面壳，所有数据面 401）。
 *  解不出（格式坏/无 claim）按无会话处理。 */
function tokenUsername(token: string | undefined): string | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { username?: unknown };
    return typeof payload.username === 'string' ? payload.username : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  // ★ API proxy: forward /api/* to NestJS with full cookie passthrough
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const targetUrl = `${apiLoopbackOrigin()}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!['host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'expect', 'content-length'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // ★ 从 request.cookies 重建 cookie 串 —— Next.js 会把原始 cookie header 解析到
    //    request.cookies API，导致 request.headers.get('cookie') 返回 null。
    const allCookies = request.cookies.getAll();
    if (allCookies.length > 0) {
      headers.set('cookie', allCookies.map((c) => `${c.name}=${c.value}`).join('; '));
    }
    if (!headers.has('x-portal')) headers.set('x-portal', 'web');
    /* :3011 总数据裁定（2026-11-03）：代理注入来源头并覆盖任何传入值——浏览器
     * JS 无法伪造本头（评审 F1：body 自报 portal 可被任意客户端冒充）。API 侧
     * assistant chat 据此对内部角色置 ctx.totalData（集团总数据口径） */
    headers.set('x-portal-source', 'mobile-3011');

    const init: RequestInit = { method: request.method, headers };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    try {
      const upstream = await fetch(targetUrl, init);
      const resHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          resHeaders.set(key, value);
        }
      });
      return new NextResponse(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: resHeaders,
      });
    } catch {
      return new NextResponse(
        JSON.stringify({ statusCode: 502, code: 'PROXY_ERROR', error: '后端服务未启动' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // ★ Auth gate: non-API routes check token_web + 门户账号白名单（仅 admin）
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const username = tokenUsername(token);
  if (!token || !username) {
    const loginUrl = new URL('/login', request.url);
    // 带上 search（登录后回跳原样 push）——深链 query 不丢：?category= 筛选直达、
    // /archive?pmi= 重定向后的 ?archivePmi= 归档卷直达（此前只保 pathname，query 全丢）
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  if (!MOBILE_ALLOWED_USERNAMES.has(username)) {
    // 有效会话但非 admin 账号（多来自 :3005 登录复用 cookie）——denied 标记供登录页
    // 展示引导提示；redirect 链保留，admin 登录后仍落原目标页
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('denied', '1');
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|_next|manifest.webmanifest|$|.*\\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$).+)',
  ],
};
