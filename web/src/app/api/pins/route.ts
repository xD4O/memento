import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET() {
  const { rows } = await db.query(
    `SELECT id, kind, text, due_on::text, status, source, source_entry_id,
            created_at::date::text AS created,
            (due_on IS NOT NULL AND due_on < current_date AND status = 'active') AS overdue,
            (due_on = current_date) AS due_today
     FROM pins
     WHERE user_id = $1 AND deleted_at IS NULL
       AND (status = 'active' OR updated_at > now() - interval '7 days')
     ORDER BY (status = 'active') DESC, due_on NULLS LAST, created_at DESC
     LIMIT 100`,
    [USER_ID]
  );
  return NextResponse.json({ pins: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim().slice(0, 200);
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(body.due ?? "")) ? body.due : null;
  const kind = body.kind === "reminder" || due ? "reminder" : "note";
  const source = body.source === "agent" ? "agent" : "user";
  const { rows } = await db.query(
    `INSERT INTO pins (user_id, kind, text, due_on, source)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [USER_ID, kind, text, due, source]
  );
  return NextResponse.json({ id: rows[0].id, kind, due }, { status: 201 });
}
