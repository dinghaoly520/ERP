import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalURL } from '@water-erp/config';

/**
 * 开标管理端（:3007）鉴权拦截。
 *
 * 角色路由：admin / bid_host 经"在线开评标系统"(:3006)登录后写到 token_bid cookie 跳到本门户。
 * 本门户读 token_bid、以 X-Portal: bid 调用后端鉴权。
 *
 * 未登录或 token 失效时，跳转"在线开评标系统"登录页（专家门户）。
 */
const PORTAL = 'bid';
const COOKIE = `token_${PORTAL}`;
const publicPaths = ['/api', '/assets'];
const LOGIN_URL = portalURL('expert', '/login?forceLogin=1');

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL(LOGIN_URL));
  }

  try {
    const res = await fetch(portalURL('api', '/api/auth/me'), {
      headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
    });
    if (!res.ok) {
      return NextResponse.redirect(new URL(LOGIN_URL));
    }
    const me = await res.json();
    const ALLOWED_ROLES = ['admin', 'bid_host', 'leader', 'staff'];
    if (!ALLOWED_ROLES.includes(me?.role)) {
      return NextResponse.redirect(new URL(LOGIN_URL));
    }
  } catch {
    return NextResponse.redirect(new URL(LOGIN_URL));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
