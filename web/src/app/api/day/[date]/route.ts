import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ date: string }> }
) {
  const { date } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "bad date" }, { status: 400 });

  const [entries, summary, meta, pins] = await Promise.all([
    db.query(
      `SELECT id, kind, status, sol, title, summary, mood, thumb_uri,
              duration_s, to_char(recorded_at, 'HH24:MI') AS at
       FROM entries
       WHERE user_id = $1 AND deleted_at IS NULL AND status <> 'sealed'
         AND recorded_at::date = $2
       ORDER BY recorded_at`,
      [USER_ID, date]
    ),
    db.query(
      `SELECT summary, highlights, mood, entry_count,
              to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
       FROM daily_summaries WHERE user_id = $1 AND day = $2`,
      [USER_ID, date]
    ),
    db.query(
      `SELECT ($2::date - journal_started_on) + 1 AS sol,
              ($2::date >= current_date) AS is_today_or_future
       FROM users WHERE id = $1`,
      [USER_ID, date]
    ),
    db.query(
      `SELECT id, kind, text, status,
              (due_on < current_date AND status = 'active') AS overdue
       FROM pins
       WHERE user_id = $1 AND deleted_at IS NULL AND due_on = $2
       ORDER BY status = 'active' DESC, created_at`,
      [USER_ID, date]
    ),
  ]);

  return NextResponse.json({
    date,
    sol: meta.rows[0]?.sol ?? null,
    pendingSummary: meta.rows[0]?.is_today_or_future && entries.rows.length > 0,
    entries: entries.rows,
    pins: pins.rows,
    report: summary.rows[0] ?? null,
  });
}
