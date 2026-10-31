import { type NextRequest, NextResponse } from "next/server";

const PROTECTED = [
  "/",
  "/chat",
  "/memory",
  "/profile",
  "/settings",
  "/projects",
  "/jobs",
  "/images",
  "/vibe",
  "/journal",
  "/goals",
];
const SESSION_COOKIE = "axtra_session";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isProtected = PROTECTED.some(
    (path) => pathname === path || pathname.startsWith(path + "/"),
  );

  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)",
  ],
};
