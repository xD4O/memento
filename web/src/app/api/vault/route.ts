import { NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

const COLUMNS = `id, sol, kind, status, title, summary, recorded_at,
                 duration_s, thumb_uri`;

/** Everything that is off the timeline but still on disk. */
export async function GET() {
  const [trash, archive] = await Promise.all([
    db.query(
      `SELECT ${COLUMNS}, deleted_at
         FROM entries
        WHERE user_id = $1 AND deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
        LIMIT 200`,
      [USER_ID]
    ),
    db.query(
      `SELECT ${COLUMNS}, archived_at
         FROM entries
        WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NOT NULL
        ORDER BY archived_at DESC
        LIMIT 200`,
      [USER_ID]
    ),
  ]);

  return NextResponse.json({
    trash: trash.rows,
    archive: archive.rows,
  });
}
