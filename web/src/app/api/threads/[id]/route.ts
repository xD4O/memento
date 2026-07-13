import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (!["open", "resolved", "dropped"].includes(body.status))
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  await db.query(
    `UPDATE threads SET status = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL`,
    [body.status, id, USER_ID]
  );
  return NextResponse.json({ ok: true });
}
