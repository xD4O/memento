import { db, USER_ID } from "@/lib/db";
import LiveConsole from "./LiveConsole";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const { rows } = await db.query(
    `SELECT (current_date - journal_started_on) + 1 AS sol FROM users WHERE id = $1`,
    [USER_ID]
  );
  return <LiveConsole sol={rows[0]?.sol ?? 1} />;
}
