import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { rows } = await db.query(
    `SELECT id, kind, status, recorded_at, sol, duration_s, title, summary,
            mood, media_mime, cost_usd, vision, error,
            (SELECT count(*)::int FROM entries e2
             WHERE e2.user_id = entries.user_id AND e2.deleted_at IS NULL
               AND e2.recorded_at <= entries.recorded_at) AS entry_no,
            (SELECT settings->>'display_name' FROM users u
             WHERE u.id = entries.user_id) AS user_name
     FROM entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       AND status <> 'sealed'`,
    [id, USER_ID]
  );
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [segments, annotations] = await Promise.all([
    db.query(
      `SELECT idx, t_start, t_end, speaker, text, words
       FROM segments WHERE entry_id = $1 ORDER BY idx`,
      [id]
    ),
    db.query(
      `SELECT id, type, source, label, note, t_start
       FROM annotations
       WHERE entry_id = $1 AND deleted_at IS NULL
       ORDER BY t_start NULLS LAST, created_at`,
      [id]
    ),
  ]);
  return NextResponse.json({
    entry: rows[0],
    segments: segments.rows,
    annotations: annotations.rows,
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  await db.query(
    `UPDATE entries SET deleted_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  return NextResponse.json({ ok: true });
}

/** Vault actions: move an entry between the timeline, the archive and the trash.
 *  All three are reversible and none touch stored media. There is deliberately
 *  no permanent-delete action — trash is a holding area, not a shredder. */
const ACTIONS: Record<string, string> = {
  restore: `UPDATE entries SET deleted_at = NULL
             WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`,
  archive: `UPDATE entries SET archived_at = now()
             WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
               AND archived_at IS NULL`,
  unarchive: `UPDATE entries SET archived_at = NULL
               WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL`,
};

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const sql = ACTIONS[action];
  if (!sql) {
    return NextResponse.json(
      { error: `unknown action; expected one of ${Object.keys(ACTIONS).join(", ")}` },
      { status: 400 }
    );
  }
  const res = await db.query(sql, [id, USER_ID]);
  if (res.rowCount === 0) {
    return NextResponse.json(
      { error: "entry not found, or already in that state" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, action });
}
