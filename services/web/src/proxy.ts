import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CONFIG } from "@/lib/config";

// Rutas accesibles SOLO cuando NO estás autenticado
const AUTH_ROUTES = ["/login"];

// Rutas explícitamente públicas (ejemplo: landing, términos, etc.)
const PUBLIC_ROUTES = ["/", "/terms", "/privacy"];

export function proxy(request: NextRequest) {
  const token = request.cookies.get(CONFIG.authCookie)?.value;
  const { pathname } = request.nextUrl;

  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname === route);

  // Todo lo que NO sea ruta de Auth ni ruta Pública se considera PROTEGIDO
  const isProtectedRoute = !isAuthRoute && !isPublicRoute;

  // 1. Sin token intentando entrar a zona protegida -> Redirigir a Login
  if (isProtectedRoute && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Con token intentando entrar a Login, Register, Forgot Password, etc. -> Redirigir a la app
  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
