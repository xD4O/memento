import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

const CATS = ["value", "goal", "person", "preference", "sensitivity", "context"];

export async function GET() {
  const { rows } = await db.query(
    `SELECT id, category, fact, source, created_at::date::text AS since
     FROM profile_facts
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY category, created_at DESC`,
    [USER_ID]
  );
  return NextResponse.json({ facts: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fact = String(body.fact ?? "").trim().slice(0, 300);
  const category = CATS.includes(body.category) ? body.category : "context";
  if (!fact) return NextResponse.json({ error: "fact required" }, { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO profile_facts (user_id, category, fact, source)
     VALUES ($1, $2, $3, 'user') RETURNING id`,
    [USER_ID, category, fact]
  );
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
