import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.query(
    `UPDATE annotations a SET deleted_at = now()
     FROM entries e
     WHERE a.id = $1 AND a.entry_id = e.id AND e.user_id = $2
       AND a.deleted_at IS NULL`,
    [id, USER_ID]
  );
  return NextResponse.json({ ok: true });
}
