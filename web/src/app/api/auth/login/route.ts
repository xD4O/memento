import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { clientIp, sessionResponse, throttled } from "@/lib/authRequest";
import {
  getStoredHash,
  hashPassphrase,
  setStoredHash,
  verifyAgainst,
} from "@/lib/passphrase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (throttled(ip)) {
    console.warn(`[auth] throttled login attempts from ${ip}`);
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const passphrase = String(body.passphrase ?? "");
  const stored = await getStoredHash();
  if (!verifyAgainst(stored, passphrase)) {
    console.warn(`[auth] failed login from ${ip}`);
    return NextResponse.json({ error: "Access denied." }, { status: 401 });
  }

  // legacy .env hash → migrate into the users row on first successful login
  const { rows } = await db.query(
    `SELECT settings ? 'auth_hash' AS has FROM users WHERE id = $1`,
    [USER_ID]
  );
  if (!rows[0]?.has) await setStoredHash(hashPassphrase(passphrase));

  console.log(`[auth] operator authenticated from ${ip}`);
  return sessionResponse(req);
}
