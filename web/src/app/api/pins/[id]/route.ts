import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.status && !["active", "done", "dismissed"].includes(body.status))
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  const due =
    body.due === null || /^\d{4}-\d{2}-\d{2}$/.test(String(body.due ?? ""))
      ? body.due
      : undefined;
  await db.query(
    `UPDATE pins SET
       status = COALESCE($1, status),
       due_on = CASE WHEN $2::boolean THEN $3::date ELSE due_on END,
       updated_at = now()
     WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL`,
    [body.status ?? null, due !== undefined, due ?? null, id, USER_ID]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  await db.query(
    `UPDATE pins SET deleted_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  return NextResponse.json({ ok: true });
}
