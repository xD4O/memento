import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const ref =
    process.env.NARRATOR_REF ??
    path.join(process.cwd(), "..", "assets", "narrator.jpg");
  try {
    const img = await readFile(ref);
    return new NextResponse(new Uint8Array(img), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return NextResponse.json({ error: "no narrator image" }, { status: 404 });
  }
}
