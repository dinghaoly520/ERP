import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'token_web';

/**
 * Global auth gate — runs on every matching route before React renders.
 * If token_web cookie is absent, redirect to /login preserving the original
 * destination as ?redirect= param so the login page can send you back.
 *
 * This is a safety net; each page still does its own client-side auth check.
 * The middleware catches the case where client-side navigation loses the cookie
 * or the session expires before React hydrates.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Protect all routes except:
     *   /login         — login page (no auth needed)
     *   /api/*         — API proxy → NestJS (backend handles auth)
     *   /_next/*       — static assets & HMR
     *   / (root)       — handled by page.tsx itself
     */
    '/((?!login|api|_next|$|.*\\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$).+)',
  ],
};
