import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET() {
  const { rows } = await db.query(
    `SELECT id, title, detail, status, source_entry_id,
            created_at::date::text AS opened,
            (current_date - created_at::date) AS age_days
     FROM threads
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY (status = 'open') DESC, updated_at DESC
     LIMIT 60`,
    [USER_ID]
  );
  return NextResponse.json({ threads: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim().slice(0, 120);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO threads (user_id, title, detail) VALUES ($1, $2, $3) RETURNING id`,
    [USER_ID, title, String(body.detail ?? "").trim().slice(0, 500) || null]
  );
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
