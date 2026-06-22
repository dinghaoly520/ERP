import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/api', '/assets'];
const PORTAL = 'mall';
const COOKIE = `token_${PORTAL}`;

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 验证 token 是否有效 — 直接调用后端 API
  try {
    const res = await fetch('http://localhost:4001/api/auth/me', {
      headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
    });
    if (!res.ok) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
