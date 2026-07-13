import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

type Turn = { speaker: "user" | "agent"; text: string; t: number };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const turns: Turn[] = Array.isArray(body.turns)
    ? body.turns.filter(
        (t: Turn) =>
          (t.speaker === "user" || t.speaker === "agent") &&
          typeof t.text === "string" &&
          t.text.trim()
      )
    : [];
  if (turns.length === 0)
    return NextResponse.json({ error: "no turns" }, { status: 400 });

  const recordedAt = body.startedAt ? new Date(body.startedAt) : new Date();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // hasMedia: client will PUT the session recording next (that flips status
    // to 'uploaded'); otherwise queue for the worker immediately.
    const costUsd =
      Number.isFinite(Number(body.costUsd)) && Number(body.costUsd) >= 0
        ? Number(body.costUsd)
        : null;
    const entry = await client.query(
      `INSERT INTO entries (user_id, kind, status, recorded_at, sol, cost_usd)
       VALUES ($1, 'live_session', $2, $3,
               (SELECT (current_date - journal_started_on) + 1 FROM users WHERE id = $1),
               $4)
       RETURNING id`,
      [USER_ID, body.hasMedia ? "created" : "uploaded", recordedAt, costUsd]
    );
    const entryId = entry.rows[0].id;
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const tEnd = i + 1 < turns.length ? turns[i + 1].t : t.t + 5;
      await client.query(
        `INSERT INTO segments (entry_id, idx, t_start, t_end, speaker, text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entryId, i, t.t, tEnd, t.speaker, t.text.trim()]
      );
    }
    await client.query("COMMIT");
    return NextResponse.json({ id: entryId }, { status: 201 });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
