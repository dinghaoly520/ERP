import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PORTAL = 'expert';
const COOKIE = `token_${PORTAL}`;

async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:4001/api/auth/me', {
      headers: { Cookie: `${COOKIE}=${token}`, 'X-Portal': PORTAL },
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
    if (token && await verifyToken(token)) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // Block all other routes without valid auth
  if (!token || !(await verifyToken(token))) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
