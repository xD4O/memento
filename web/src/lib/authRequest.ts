import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/authToken";

// per-IP throttle: 5 attempts per minute (in-memory; single-instance app)
const attempts = new Map<string, { n: number; reset: number }>();

export function throttled(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now > a.reset) {
    attempts.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  a.n++;
  return a.n > 5;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function cookieSecure(req: NextRequest): boolean {
  const host = req.headers.get("host") ?? "";
  return (
    req.headers.get("x-forwarded-proto") === "https" ||
    req.nextUrl.protocol === "https:" ||
    host.startsWith("localhost")
  );
}

export async function sessionResponse(req: NextRequest): Promise<NextResponse> {
  const token = await signSession(process.env.AUTH_SECRET ?? "");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(req),
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
  return res;
}
