import { db, USER_ID } from "@/lib/db";
import RecordConsole from "./RecordConsole";

export const dynamic = "force-dynamic";

export default async function RecordPage() {
  const { rows } = await db.query(
    `SELECT (current_date - journal_started_on) + 1 AS sol,
            settings->>'display_name' AS user_name,
            (SELECT count(*)::int + 1 FROM entries
             WHERE user_id = $1 AND deleted_at IS NULL) AS entry_no
     FROM users WHERE id = $1`,
    [USER_ID]
  );
  const sol = rows[0]?.sol ?? 1;
  const entryNo = rows[0]?.entry_no ?? 1;

  return (
    <RecordConsole sol={sol} entryNo={entryNo} userName={rows[0]?.user_name ?? "USER"} />
  );
}
