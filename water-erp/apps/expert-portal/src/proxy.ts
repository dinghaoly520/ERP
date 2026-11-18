import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiLoopbackOrigin, portalOriginForHost } from '@water-erp/config';

const PORTAL = 'expert';
const COOKIE = `token_${PORTAL}`;
// 登录跳转不能用模块级 portalURL：middleware 在服务端求值恒为 localhost，
// 平板/局域网客户端被 307 到打不开的 localhost 地址（2026-09-22 平板实测）。
// 一律以请求 Host 头推导（2026-10-26 双轨：*.scsfjt.com 家族访问 → 子域跳转；IP/端口访问 → 同主机+端口）。
const requestHost = (request: NextRequest) =>
  (request.headers.get('x-forwarded-host') || request.headers.get('host') || '')
    .split(',')[0]
    .trim() || request.nextUrl.hostname;
const requestProto = (request: NextRequest) =>
  (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
const loginUrlFor = (request: NextRequest, pathname: string) => {
  const origin = portalOriginForHost('expert', requestHost(request), requestProto(request));
  const u = new URL(`${origin}/login?forceLogin=1`);
  u.searchParams.set('redirect', pathname);
  return u;
};

/** 鉴权回源请求头（2026-11-09 限流收口）：透传 X-Forwarded-For——生产 nginx 覆盖式写入
 *  真实客户端 IP，此处原样带给 API（限流/审计 IP 归位）；无 XFF（dev 直连）不设头，
 *  API 落 socket 地址，语义与改前一致。/api/* 数据面走 next.config rewrites 天然透传，无需处理。 */
const authHeaders = (request: NextRequest, cookie: string) => {
  const h: Record<string, string> = { Cookie: cookie, 'X-Portal': PORTAL };
  const xff = request.headers.get('x-forwarded-for');
  if (xff) h['X-Forwarded-For'] = xff;
  return h;
};

export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public assets without auth (images, css, js chunks)
  if (
    pathname.startsWith('/assets') ||
    // bug#163（2026-11-17）：/socket.io 轮询放行——转发走 next.config rewrites（同 /api/*，
    // matcher 的 (?!api 排除不到它），鉴权由 API 网关在握手层做（cookie 透传）；不 bypass
    // 则每次轮询触发一次 /api/auth/me 回源，匿名握手被 302 拦死。
    pathname.startsWith('/socket.io') ||
    pathname.startsWith('/models') || // 2026-09-18 身份核验 R3：MediaPipe 模型/wasm 自托管静态件（Apache-2.0 无敏感信息）
    /\.(png|jpg|jpeg|gif|svg|ico|webp|css)$/i.test(pathname) ||
    // P3-9（2026-09-15）：PWA 静态件放行——被 307 到登录页时 Chrome 拿登录页 HTML 当
    // manifest 解析（console「Manifest: Syntax error」），Service Worker 注册同理失效
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js'
  ) {
    return NextResponse.next();
  }

  // 设备模式手动切换（?device=tablet|desktop）已删（2026-11-18 用户裁定 B）：device_mode cookie
  // 自 2026-10-26 起不驱动任何路由决策（唯一消费方是登录页文案翻转=死代码），且登录页互切
  // 链接引导平板走全量登录与 TAB-SYNC-01 配对制冲突（平板全量登录曾致评标期账号锁死）。
  // 平板唯一正规入口 = 桌面「配对打分平板」出码 → /tablet/pair；直接访问 /tablet 仍走闸门
  // 弹回 /login?redirect=/tablet → 登录后直达（此流程不依赖 device cookie）。

  // Allow login page without auth. Public homepage quick-entry uses forceLogin=1
  // so users must re-enter credentials even if this portal already has a cookie.
  if (pathname === '/login') {
    if (request.nextUrl.searchParams.get('forceLogin') === '1') {
      return NextResponse.next();
    }
    if (token) {
      try {
        const res = await fetch(
          `${apiLoopbackOrigin()}/api/auth/me`,
          {
            headers: authHeaders(request, `${COOKIE}=${token}`),
          },
        );
        if (res.ok) {
          const me = await res.json();
          if (me?.role === 'bid_expert') {
            return NextResponse.redirect(new URL('/', request.url));
          }
        }
      } catch { /* token validation failed — allow login page */ }
    }
    return NextResponse.next();
  }

  // 邀请 + RSVP 确认页：公开访问，无需登录
  if (pathname.startsWith('/invitation') || pathname.startsWith('/rsvp')) {
    return NextResponse.next();
  }

  // 演示/验证页（2026-10-23）：免登录实机验证签到摄像头遮挡检测（/demo/face）——
  // 纯客户端组件，零 API 调用零写库，局域网演示机回归用
  if (pathname.startsWith('/demo')) {
    return NextResponse.next();
  }

  // 平板配对页（TAB-SYNC-01；2026-09-22 迁移制演进为配对制）：扫码进入时平板尚无会话——
  // 票据+密码在页内提交，成功后由 API 写 token_expert（受限配对令牌）再跳评审页；
  // 桌面 QR 短时效票据即入口凭证
  if (pathname === '/tablet/pair') {
    return NextResponse.next();
  }

  // Block all other routes without valid auth
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // token 失效/角色不符时回登录页，保留 redirect 以便登录后回到原页面（如邀请确认页）
  const loginWithRedirect = () => NextResponse.redirect(loginUrlFor(request, pathname));
  try {
    // 鉴权回源：portalURL 在 middleware（无 window）恒落 localhost 占位不可用。server-internal
    // 跳直达本机回环（apiLoopbackOrigin：env 覆盖 > 127.0.0.1:4001）——勿按请求域名推导公网
    // api 子域（hairpin NAT 风险，2026-10-27 复盘）。
    const res = await fetch(
      `${apiLoopbackOrigin()}/api/auth/me`,
      {
        headers: authHeaders(request, `${COOKIE}=${token}`),
      },
    );
    if (!res.ok) {
      return loginWithRedirect();
    }
    const me = await res.json();
    if (me?.role !== 'bid_expert') {
      return loginWithRedirect();
    }
  } catch {
    return loginWithRedirect();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
