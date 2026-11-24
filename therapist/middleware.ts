import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Cheap gate: no session cookie means no portal page and no API proxy.
 * The cookie only says someone signed in; core still validates the token on every call.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Everything except the sign-in page, Next internals and static files.
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
