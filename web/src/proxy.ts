import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/authToken";

export default async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySession(token, process.env.AUTH_SECRET ?? "");
  if (ok) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/"))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // guard everything except the login/register flow and static assets
    "/((?!login|register|api/auth/login|api/auth/register|_next/static|_next/image|favicon\\.ico|icons/|manifest\\.webmanifest).*)",
  ],
};
