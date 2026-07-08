import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { portalURL } from '@water-erp/config';

const PORTAL = 'expert';
const COOKIE = `token_${PORTAL}`;
const LOGIN_URL = portalURL('expert', '/login?forceLogin=1');

export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public assets without auth
  if (pathname.startsWith('/assets')) {
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
            return NextResponse.redirect(new URL('/', request.url));
          }
        }
      } catch { /* token validation failed — allow login page */ }
    }
    return NextResponse.next();
  }

  // Block all other routes without valid auth
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const res = await fetch(portalURL('api', '/api/auth/me'), {
      headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
    });
    if (!res.ok) {
      return NextResponse.redirect(new URL(LOGIN_URL));
    }
    const me = await res.json();
    if (me?.role !== 'bid_expert') {
      return NextResponse.redirect(new URL(LOGIN_URL));
    }
  } catch {
    return NextResponse.redirect(new URL(LOGIN_URL));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
