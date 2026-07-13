import { NextRequest, NextResponse } from "next/server";
import { clientIp, throttled } from "@/lib/authRequest";
import {
  getStoredHash,
  hashPassphrase,
  setStoredHash,
  verifyAgainst,
} from "@/lib/passphrase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (throttled(ip))
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (next.length < 8)
    return NextResponse.json(
      { error: "New passphrase must be at least 8 characters." },
      { status: 400 }
    );
  if (!verifyAgainst(await getStoredHash(), current)) {
    console.warn(`[auth] failed passphrase change from ${ip}`);
    return NextResponse.json(
      { error: "Current passphrase is wrong." },
      { status: 401 }
    );
  }

  await setStoredHash(hashPassphrase(next));
  console.log(`[auth] passphrase changed from ${ip}`);
  return NextResponse.json({ ok: true });
}
