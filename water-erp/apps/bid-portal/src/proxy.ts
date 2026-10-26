import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalOriginForHost } from '@water-erp/config';

/**
 * 开标管理端（:3007）鉴权拦截。
 *
 * 角色路由：admin / bid_host 经"在线开评标系统"(:3006)登录后写到 token_bid cookie 跳到本门户。
 * 本门户读 token_bid、以 X-Portal: bid 调用后端鉴权。
 *
 * 未登录或 token 失效时，跳转"在线开评标系统"登录页（专家门户）。
 * 跨门户跳转按请求 Host 头推导（2026-09-22 平板实测：localhost 打不开；2026-10-26 双轨：
 * *.scsfjt.com 家族访问 → 子域跳转；IP/端口访问 → 同主机+端口）。
 */
const PORTAL = 'bid';
const COOKIE = `token_${PORTAL}`;
const publicPaths = ['/api', '/assets'];
const requestHost = (request: NextRequest) =>
  (request.headers.get('x-forwarded-host') || request.headers.get('host') || '')
    .split(',')[0]
    .trim() || request.nextUrl.hostname;
const requestProto = (request: NextRequest) =>
  (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
const expertLoginUrl = (request: NextRequest) => {
  const origin = portalOriginForHost('expert', requestHost(request), requestProto(request));
  return new URL(`${origin}/login?forceLogin=1`);
};

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(expertLoginUrl(request));
  }

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
      return NextResponse.redirect(expertLoginUrl(request));
    }
    const me = await res.json();
    const ALLOWED_ROLES = ['admin', 'bid_host', 'leader', 'staff'];
    if (!ALLOWED_ROLES.includes(me?.role)) {
      return NextResponse.redirect(expertLoginUrl(request));
    }
  } catch {
    return NextResponse.redirect(expertLoginUrl(request));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
