import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth';

const PROTECTED_PATHS = ['/', '/calendar'];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((protectedPath) => pathname === protectedPath || pathname.startsWith(`${protectedPath}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionCookie);

  if (pathname.startsWith('/login')) {
    if (session) {
      const destination = new URL('/', request.url);
      return NextResponse.redirect(destination);
    }
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/', '/calendar/:path*', '/login']
};
