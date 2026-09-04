import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiOrigin } from '@water-erp/config';

// 供应商门户（supplier-portal-next）API 代理 + 登录门禁
// 方案移植自 apps/web/src/proxy.ts；差异点：cookie 名 token_supplier、门户头 supplier，
// 以及游客路由（login / register / register-temporary / 公开回执页 rsvp）。
const AUTH_COOKIE_NAME = 'token_supplier';
const API_TARGET = process.env.API_SERVER_URL ?? apiOrigin();

export async function proxy(request: NextRequest) {
  // ★ API proxy: forward /api/* to NestJS with full cookie passthrough
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const targetUrl = `${API_TARGET}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!['host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // ★ 从 request.cookies 重建 cookie 串 —— Next.js 会把原始 cookie header 解析到
    //    request.cookies API，导致 request.headers.get('cookie') 返回 null。
    const allCookies = request.cookies.getAll();
    if (allCookies.length > 0) {
      headers.set('cookie', allCookies.map((c) => `${c.name}=${c.value}`).join('; '));
    }
    if (!headers.has('x-portal')) headers.set('x-portal', 'supplier');

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
        JSON.stringify({ statusCode: 502, code: 'PROXY_ERROR', error: '服务暂时不可用，请稍后重试' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // ★ Auth gate: 非公开页面检查 token_supplier
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // 游客/公开路由：login、register、register-temporary（正式+临时注册）、rsvp（回执公开页）
  matcher: [
    '/((?!login|register|register-temporary|rsvp|_next|$|.*\\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$).+)',
  ],
};
