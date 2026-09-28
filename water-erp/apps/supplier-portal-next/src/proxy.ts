import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiOrigin } from '@water-erp/config';

// 供应商门户（supplier-portal-next）API 代理 + 登录门禁
// 方案移植自 apps/web/src/proxy.ts；差异点：cookie 名 token_supplier、门户头 supplier，
// 以及游客路由（login / register / register-temporary / 公开回执页 rsvp）。
const AUTH_COOKIE_NAME = 'token_supplier';
const API_TARGET = process.env.API_SERVER_URL ?? apiOrigin();
// 登录/注册页随机背景池 + cookie 名：随机结果持久化到 cookie（SSR 可读），首帧即最终图，无切换闪烁
const BG_POOL = ['login-bg-1.jpg', 'login-bg-2.jpg', 'login-bg-3.jpg'];
const BG_COOKIE = 'supplier_bg';
const BG_PENDING = 'supplier_bg_pending';
const GUEST_PAGES = ['/login', '/register', '/register-temporary', '/rsvp'];

/** 是否为门户内登录/注册页之间的跳转（登录↔注册↔临时注册↔回执）——此类沿用同一背景，不重投。 */
function isInFlowNavigation(request: NextRequest): boolean {
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    const u = new URL(referer);
    // 同页刷新/同页再次加载视为新进入 → 重投；仅跨页跳转沿用
    if (u.pathname === request.nextUrl.pathname) return false;
    return GUEST_PAGES.some((p) => u.pathname === p || u.pathname.startsWith(p + '/'));
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  // ★ API proxy: forward /api/* to NestJS with full cookie passthrough
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const targetUrl = `${API_TARGET}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const headers = new Headers();
    request.headers.forEach((value, key) => {
      // expect（100-continue）大文件上传时浏览器/curl 会带，undici 不支持导致上游 fetch 直接失败
      // （"expect header not supported"）→ 502——剥离后再转发（2026-09-10 实测 20MB+ 标书上传全挂）。
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
    if (!headers.has('x-portal')) headers.set('x-portal', 'supplier');

    const init: RequestInit = { method: request.method, headers };
    if (!['GET', 'HEAD'].includes(request.method)) {
      // 2026-09-18 修复（Node 24.14.1 / Next 16.2.3 双杀原方案）：
      //  - 旧流式透传（request.body + duplex:'half'）被 undici 7.24.4 拒绝
      //    （"expected non-null body source"）→ 所有 POST 502，登录/注册全断；
      //  - 改缓冲转发后大请求体又被截断 → 根因是 Next 16 proxy 默认请求体上限 ~1.5MB，
      //    已在 next.config.ts experimental.proxyClientMaxBodySize 提到 500MB（与 web 一致）。
      // 现与本门户外的其他门户同构：arrayBuffer 缓冲转发，20MB 实测经代理往返字节一致。
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
    } catch (e) {
      const err = e as Error & { cause?: Error };
      return new NextResponse(
        JSON.stringify({ statusCode: 502, code: 'PROXY_ERROR', error: `服务暂时不可用（${err?.message ?? String(e)}${err?.cause?.message ? ' / cause: ' + err.cause.message : ''}）` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const pathname = request.nextUrl.pathname;
  const isGuestPage = GUEST_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // 游客页（登录/注册）：SSR 首帧即渲染出随机背景（无「兜底图→随机图」闪烁）。
  // 重投规则：每次「新进入门户」（新标签/地址栏/外部链接/同页刷新，或首次）重投随机；
  // 门户内登录↔注册↔临时注册之间的跨页跳转沿用同一张，避免换页时背景突变。
  if (isGuestPage) {
    // 上次 307 携带的瞬态标记：清除后直接放行，避免重定向死循环
    if (request.cookies.get(BG_PENDING)) {
      const res = NextResponse.next();
      res.cookies.delete(BG_PENDING);
      return res;
    }
    const hasBg = !!request.cookies.get(BG_COOKIE);
    if (hasBg && isInFlowNavigation(request)) {
      return NextResponse.next();
    }
    const pick = BG_POOL[Math.floor(Math.random() * BG_POOL.length)];
    const res = NextResponse.redirect(request.url);
    res.cookies.set(BG_COOKIE, pick, { path: '/', httpOnly: true });
    res.cookies.set(BG_PENDING, '1', { path: '/', httpOnly: true, maxAge: 60 });
    return res;
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
    '/((?!_next|$|.*\\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$).+)',
  ],
};
