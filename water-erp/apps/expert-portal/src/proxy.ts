import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalURL } from '@water-erp/config';

const PORTAL = 'expert';
const COOKIE = `token_${PORTAL}`;
const LOGIN_URL = portalURL('expert', '/login?forceLogin=1');

/**
 * 无线网络 / 平板设备检测
 *
 * 检测策略（按优先级）：
 * 1. X-Forwarded-Device 头 → 生产环境由反向代理根据无线子网注入
 * 2. User-Agent 匹配 → 开发/当前同局域网场景
 * 3. TABLET_SUBNETS 环境变量 → 生产环境直接 IP 子网匹配（未来扩展）
 */
function isTabletDevice(request: NextRequest): boolean {
  // 1. 反向代理注入的设备类型头（生产环境推荐方案）
  const forwardedDevice = request.headers.get('x-forwarded-device');
  if (forwardedDevice === 'tablet') return true;

  // 2. User-Agent 检测
  const ua = request.headers.get('user-agent') || '';
  // 明确标识的平板 / 电子书 / 电视
  if (/iPad|PlayBook|Kindle|Silk|KFAPWI|Tablet|CrOS/i.test(ua)) return true;
  // Android 平板：有 Android 但无 Mobile（手机才有 Mobile）
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true;

  return false;
}

export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public assets without auth (images, css, js chunks)
  if (pathname.startsWith('/assets') || /\.(png|jpg|jpeg|gif|svg|ico|webp|css)$/i.test(pathname)) {
    return NextResponse.next();
  }

  // Allow login page without auth. Public homepage quick-entry uses forceLogin=1
  // so users must re-enter credentials even if this portal already has a cookie.
  if (pathname === '/login') {
    if (request.nextUrl.searchParams.get('forceLogin') === '1') {
      return NextResponse.next();
    }
    if (token) {
      try {
        const res = await fetch(portalURL('api', '/api/auth/me'), {
          headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
        });
        if (res.ok) {
          const me = await res.json();
          if (me?.role === 'bid_expert') {
            const target = isTabletDevice(request) ? '/tablet' : '/';
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

  // Block all other routes without valid auth
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // token 失效/角色不符时回登录页，保留 redirect 以便登录后回到原页面（如邀请确认页）
  const loginWithRedirect = () => {
    const u = new URL(LOGIN_URL);
    u.searchParams.set('redirect', pathname);
    return NextResponse.redirect(u);
  };
  try {
    const res = await fetch(portalURL('api', '/api/auth/me'), {
      headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
    });
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

  // ── 设备模式判断（手动覆盖 > cookie > UA 检测）──
  const DEVICE_COOKIE = 'device_mode';
  const queryDevice = request.nextUrl.searchParams.get('device'); // ?device=tablet|desktop

  let tabletMode = false;

  if (queryDevice === 'tablet' || queryDevice === 'desktop') {
    // 手动切换：写入 cookie 持久化
    tabletMode = queryDevice === 'tablet';
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

  const deviceCookie = request.cookies.get(DEVICE_COOKIE)?.value;
  if (deviceCookie === 'tablet') {
    tabletMode = true;
  } else if (deviceCookie === 'desktop') {
    tabletMode = false;
  } else {
    // 无 cookie → 走 UA 检测
    tabletMode = isTabletDevice(request);
  }

  // ── 无线网络 / 平板设备隔离 ──
  // 平板设备只允许访问 tablet 路由和 login/assets，桌面端路由一律重定向
  if (tabletMode) {
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
