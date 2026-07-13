import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const type = ["flag", "highlight", "action_item", "insight"].includes(body.type)
    ? body.type
    : "flag";
  const label = String(body.label ?? "").trim().slice(0, 120);
  if (!label)
    return NextResponse.json({ error: "label required" }, { status: 400 });

  const entry = await db.query(
    `SELECT id FROM entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  if (!entry.rows[0])
    return NextResponse.json({ error: "not found" }, { status: 404 });

  let segmentId: number | null = null;
  let tStart: number | null = null;
  let tEnd: number | null = null;
  if (Number.isInteger(body.segment_idx)) {
    const seg = await db.query(
      `SELECT id, t_start, t_end FROM segments WHERE entry_id = $1 AND idx = $2`,
      [id, body.segment_idx]
    );
    if (seg.rows[0]) {
      segmentId = seg.rows[0].id;
      tStart = seg.rows[0].t_start;
      tEnd = seg.rows[0].t_end;
    }
  }

  const { rows } = await db.query(
    `INSERT INTO annotations (entry_id, segment_id, t_start, t_end, type, source, label, note)
     VALUES ($1, $2, $3, $4, $5, 'user', $6, $7)
     RETURNING id`,
    [id, segmentId, tStart, tEnd, type, label, body.note ?? null]
  );
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
