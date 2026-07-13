import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

// Fallback for live sessions whose media upload failed: index transcript-only.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const { rowCount } = await db.query(
    `UPDATE entries SET status = 'uploaded'
     WHERE id = $1 AND user_id = $2 AND status = 'created' AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  if (!rowCount)
    return NextResponse.json({ error: "not queueable" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
