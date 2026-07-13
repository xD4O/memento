import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { clientIp, sessionResponse, throttled } from "@/lib/authRequest";
import { hashPassphrase, isRegistered } from "@/lib/passphrase";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ registered: await isRegistered() });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (throttled(ip))
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });

  // first-run claim only: once an operator exists, registration is closed
  if (await isRegistered()) {
    console.warn(`[auth] blocked register attempt from ${ip} (already claimed)`);
    return NextResponse.json(
      { error: "This terminal already has an operator." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const passphrase = String(body.passphrase ?? "");
  const name = String(body.displayName ?? "").trim().slice(0, 40);
  if (passphrase.length < 8)
    return NextResponse.json(
      { error: "Passphrase must be at least 8 characters." },
      { status: 400 }
    );

  await db.query(
    `UPDATE users SET settings = settings
       || jsonb_build_object('auth_hash', $1::text)
       || CASE WHEN $2::text <> '' THEN jsonb_build_object('display_name', $2::text)
               ELSE '{}'::jsonb END
     WHERE id = $3`,
    [hashPassphrase(passphrase), name, USER_ID]
  );
  console.log(`[auth] operator account claimed from ${ip}`);
  return sessionResponse(req);
}
