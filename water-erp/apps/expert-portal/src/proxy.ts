import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalOriginForHost } from '@water-erp/config';

const PORTAL = 'expert';
const COOKIE = `token_${PORTAL}`;
const DEVICE_COOKIE = 'device_mode';
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

/**
 * 平板形态判定（2026-10-19 收窄为显式信号）：只认 cookie / 反代头，不再 UA/触摸猜测——
 * maxTouchPoints>1 命中触摸屏笔记本、UA 含 CrOS 命中 Chromebook，误判后 7 天 cookie 把
 * 台式机锁进平板模式（平板端无法提交评分）。发现平板的唯一主动机制 = 桌面端扫码迁移
 * （/tablet/claim），本判定只负责「已显式声明为平板」的设备保持平板形态。
 *
 * 1. device_mode cookie：登录页「平板设备入口」链接 / ?device=tablet|desktop 手动切换写入（7 天）
 * 2. X-Forwarded-Device 头：生产环境由反向代理根据无线子网注入
 */
function isTabletMode(request: NextRequest): boolean {
  const cookie = request.cookies.get(DEVICE_COOKIE)?.value;
  if (cookie === 'tablet') return true;
  if (cookie === 'desktop') return false;
  return request.headers.get('x-forwarded-device') === 'tablet';
}

export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public assets without auth (images, css, js chunks)
  if (
    pathname.startsWith('/assets') ||
    pathname.startsWith('/models') || // 2026-09-18 身份核验 R3：MediaPipe 模型/wasm 自托管静态件（Apache-2.0 无敏感信息）
    /\.(png|jpg|jpeg|gif|svg|ico|webp|css)$/i.test(pathname) ||
    // P3-9（2026-09-15）：PWA 静态件放行——被 307 到登录页时 Chrome 拿登录页 HTML 当
    // manifest 解析（console「Manifest: Syntax error」），Service Worker 注册同理失效
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js'
  ) {
    return NextResponse.next();
  }

  // ── 设备模式手动切换（?device=tablet|desktop）：写 7 天 cookie + 302 对应首页 ──
  // 必须在鉴权闸门之前：未登录的平板从登录页「平板设备入口」点进来时，先落 cookie 再由
  // /tablet 闸门弹回 /login?redirect=/tablet，登录后直达平板工作台；若放在闸门后，匿名
  // 请求先被弹回登录页、device 参数丢失（2026-10-19 实测）。
  const queryDevice = request.nextUrl.searchParams.get('device'); // ?device=tablet|desktop
  if (queryDevice === 'tablet' || queryDevice === 'desktop') {
    const res = NextResponse.redirect(
      new URL(queryDevice === 'tablet' ? '/tablet' : '/', request.url),
    );
    res.cookies.set(DEVICE_COOKIE, queryDevice, {
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 天
      sameSite: 'lax',
    });
    return res;
  }

  // Allow login page without auth. Public homepage quick-entry uses forceLogin=1
  // so users must re-enter credentials even if this portal already has a cookie.
  if (pathname === '/login') {
    if (request.nextUrl.searchParams.get('forceLogin') === '1') {
      return NextResponse.next();
    }
    if (token) {
      try {
        const res = await fetch(
          `${portalOriginForHost('api', requestHost(request), requestProto(request))}/api/auth/me`,
          {
            headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
          },
        );
        if (res.ok) {
          const me = await res.json();
          if (me?.role === 'bid_expert') {
            const target = isTabletMode(request) ? '/tablet' : '/';
            return NextResponse.redirect(new URL(target, request.url));
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

  // 工位迁移领取页（2026-09-22）：扫码进入时平板尚无会话——票据+密码在页内提交，
  // 成功后由 API 写 token_expert 再跳评审页；桌面 QR 短时效票据即入口凭证
  if (pathname === '/tablet/claim') {
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
    // 鉴权回源：portalURL 在 middleware（无 window）恒落 localhost 占位——改按请求 Host
    // 双轨推导（域名家族 → API 子域；IP/端口 → 同主机:4001；API_ORIGIN env 最高优先）。
    const res = await fetch(
      `${portalOriginForHost('api', requestHost(request), requestProto(request))}/api/auth/me`,
      {
        headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
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

  // ── 平板形态隔离（cookie / X-Forwarded-Device 显式声明；?device= 手动切换已在闸门前处理）──
  // 平板设备只允许访问 tablet 路由和 login/assets，桌面端路由一律重定向
  if (isTabletMode(request)) {
    // 已在 tablet 子路由 → 放行
    if (pathname.startsWith('/tablet')) {
      return NextResponse.next();
    }
    // 桌面端 evaluate/[id] → 映射到 tablet evaluate/[id]
    const evalMatch = pathname.match(/^\/evaluate\/(.+)/);
    if (evalMatch) {
      return NextResponse.redirect(new URL(`/tablet/evaluate/${evalMatch[1]}`, request.url));
    }
    // 其余所有桌面端路由 → tablet 落地页（仅展示项目列表 + 平板评标按钮）
    return NextResponse.redirect(new URL('/tablet', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
