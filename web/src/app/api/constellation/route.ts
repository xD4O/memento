import { NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function GET() {
  const [nodes, edges] = await Promise.all([
    db.query(
      `SELECT c.id, c.name, c.kind, count(*)::int AS n
       FROM concepts c
       JOIN entry_concepts ec ON ec.concept_id = c.id
       JOIN entries e ON e.id = ec.entry_id AND e.deleted_at IS NULL
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY n DESC
       LIMIT 120`,
      [USER_ID]
    ),
    db.query(
      `SELECT a.concept_id AS a, b.concept_id AS b, count(*)::int AS w
       FROM entry_concepts a
       JOIN entry_concepts b
         ON a.entry_id = b.entry_id AND a.concept_id < b.concept_id
       JOIN entries e ON e.id = a.entry_id AND e.deleted_at IS NULL
         AND e.user_id = $1
       GROUP BY 1, 2
       ORDER BY w DESC
       LIMIT 400`,
      [USER_ID]
    ),
  ]);
  return NextResponse.json({ nodes: nodes.rows, edges: edges.rows });
}
