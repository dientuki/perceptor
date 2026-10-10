import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CONFIG } from "@/lib/config";

const AUTH_ROUTES = ["/login"];

const PUBLIC_ROUTES = [
  "/terms",
  "/privacy",
  "/ca.crt",
  "/sw.js",
  "/manifest.json",
  "/offline",
];

export function proxy(request: NextRequest) {
  const token = request.cookies.get(CONFIG.authCookie)?.value;
  const { pathname } = request.nextUrl;

  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname === route);

  const isProtectedRoute = !isAuthRoute && !isPublicRoute;

  if (isProtectedRoute && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
