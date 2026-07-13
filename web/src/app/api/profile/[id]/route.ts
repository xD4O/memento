import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.query(
    `UPDATE profile_facts SET deleted_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  return NextResponse.json({ ok: true });
}
