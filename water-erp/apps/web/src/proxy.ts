import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalOriginForHost } from '@water-erp/config';

const AUTH_COOKIE_NAME = 'token_web';

// API 目标请求级双轨（2026-10-26 域名部署，与 expert/bid proxy 同口径）：
// API_SERVER_URL 显式覆盖（旧别名）> portalOriginForHost（API_ORIGIN env > 请求 Host
// 家族判定：*.scsfjt.com → api 子域 https；IP/端口访问 → 同主机:4001）。
// 弃模块级 API_TARGET——middleware 边缘运行时 process.env 是构建期内联，构建时未设
// 则永久烘焙 localhost:4001（事后改 env 无效）；Host 推导是运行时通道，恒新鲜。
const requestHost = (request: NextRequest) =>
  (request.headers.get('x-forwarded-host') || request.headers.get('host') || '')
    .split(',')[0]
    .trim() || request.nextUrl.hostname;
const requestProto = (request: NextRequest) =>
  (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
const apiTargetFor = (request: NextRequest): string =>
  (process.env.API_SERVER_URL || '').replace(/\/+$/, '') ||
  portalOriginForHost('api', requestHost(request), requestProto(request));

export async function proxy(request: NextRequest) {
  // ★ API proxy: forward /api/* to NestJS with full cookie passthrough
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const targetUrl = `${apiTargetFor(request)}${request.nextUrl.pathname}${request.nextUrl.search}`;

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

  // ★ Auth gate: non-API routes check token_web
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    // 带上 search（登录后回跳原样 push）——深链 query 不丢：?category= 筛选直达、
    // /archive?pmi= 重定向后的 ?archivePmi= 归档卷直达（此前只保 pathname，query 全丢）
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|_next|$|.*\\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$).+)',
  ],
};
