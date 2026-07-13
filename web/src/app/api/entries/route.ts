import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET() {
  const { rows } = await db.query(
    `SELECT e.id, e.kind, e.status, e.recorded_at, e.sol, e.duration_s,
            e.title, e.mood, e.error,
            (SELECT count(*)::int FROM segments s WHERE s.entry_id = e.id) AS segment_count
     FROM entries e
     WHERE e.user_id = $1 AND e.deleted_at IS NULL AND e.status <> 'sealed'
     ORDER BY e.recorded_at DESC
     LIMIT 200`,
    [USER_ID]
  );
  return NextResponse.json({ entries: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = ["video_log", "audio_log"].includes(body.kind)
    ? body.kind
    : "video_log";
  const deliverOn =
    /^\d{4}-\d{2}-\d{2}$/.test(String(body.deliverOn ?? "")) &&
    new Date(body.deliverOn) > new Date()
      ? body.deliverOn
      : null;
  const { rows } = await db.query(
    `INSERT INTO entries (user_id, kind, media_mime, deliver_on, sol)
     VALUES ($1, $2, $3, $4,
             (SELECT (current_date - journal_started_on) + 1 FROM users WHERE id = $1))
     RETURNING id, sol`,
    [USER_ID, kind, body.mime ?? null, deliverOn]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
