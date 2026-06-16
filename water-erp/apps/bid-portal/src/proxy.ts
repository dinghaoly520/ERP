import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalURL } from '@water-erp/config';

/**
 * 开标管理端（:3007）鉴权拦截。
 *
 * 角色路由：admin / bid_host 经"在线开评标系统"登录后落到本门户；
 * 这两类角色在后端 portal-cookie 中命名 cookie 为 token_web（与采购管理端同命名空间），
 * 因此本门户读 token_web、并以 X-Portal: web 调用后端鉴权。
 *
 * 未登录或 token 失效时，跳转"在线开评标系统"登录页（专家门户），
 * 与公众门户"在线开评标系统"卡片入口保持一致。
 */
const PORTAL = 'web';
const COOKIE = `token_${PORTAL}`;
const publicPaths = ['/api', '/assets'];
// 专家门户登录页是"在线开评标系统"的统一登录入口；由 PORTS 派生，端口重分配后无需手动同步。
// middleware 运行在服务端（无 window），portalURL 回落到 localhost，与原硬编码行为一致。
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

  // 验证 token 是否有效 — 直接调用后端 API
  try {
    const res = await fetch('http://localhost:4001/api/auth/me', {
      headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
    });
    if (!res.ok) {
      return NextResponse.redirect(new URL(LOGIN_URL));
    }
  } catch {
    return NextResponse.redirect(new URL(LOGIN_URL));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
