import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month))
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });

  const [days, journal, pins] = await Promise.all([
    db.query(
      `SELECT d.day::text AS day,
              d.cnt AS entry_count,
              d.kinds,
              s.mood,
              (s.summary IS NOT NULL) AS has_summary
       FROM (
         SELECT recorded_at::date AS day, count(*)::int AS cnt,
                array_agg(DISTINCT kind) AS kinds
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL AND status <> 'sealed'
           AND to_char(recorded_at, 'YYYY-MM') = $2
         GROUP BY 1) d
       LEFT JOIN daily_summaries s ON s.user_id = $1 AND s.day = d.day
       ORDER BY d.day`,
      [USER_ID, month]
    ),
    db.query(
      `SELECT journal_started_on::text AS started, current_date::text AS today
       FROM users WHERE id = $1`,
      [USER_ID]
    ),
    db.query(
      `SELECT due_on::text AS day, count(*)::int AS pin_count,
              bool_or(due_on < current_date) AS has_overdue
       FROM pins
       WHERE user_id = $1 AND deleted_at IS NULL AND status = 'active'
         AND to_char(due_on, 'YYYY-MM') = $2
       GROUP BY due_on`,
      [USER_ID, month]
    ),
  ]);

  return NextResponse.json({
    days: days.rows,
    pinDays: pins.rows,
    journalStart: journal.rows[0]?.started,
    today: journal.rows[0]?.today,
  });
}
