import { NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET() {
  const { rows } = await db.query(
    `SELECT w.week_start::text, (w.week_start + 6)::text AS week_end,
            w.summary, w.highlights, w.patterns, w.mood, w.entry_count,
            ((w.week_start - date_trunc('week', u.journal_started_on)::date) / 7 + 1)
              AS mission_week
     FROM weekly_summaries w
     JOIN users u ON u.id = w.user_id
     WHERE w.user_id = $1
     ORDER BY w.week_start DESC
     LIMIT 52`,
    [USER_ID]
  );
  return NextResponse.json({ debriefs: rows });
}
