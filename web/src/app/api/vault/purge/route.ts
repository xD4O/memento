import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { s3, BUCKET } from "@/lib/s3";

export const runtime = "nodejs";

/** Permanently remove entries that are already in the trash.
 *
 *  This is the only destructive path in the app. Guard rails:
 *   - only rows with deleted_at set can be purged, so nothing on the timeline
 *     or in the archive can be destroyed by a stray request
 *   - scoped to USER_ID
 *   - segments, annotations and entry_concepts cascade; pins, threads,
 *     profile_facts and story_topics keep their rows with a null source
 *   - media objects are removed after the row, and a storage failure does not
 *     fail the request — a stray object is recoverable, a half-deleted row is
 *     not.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  const clean = ids.filter(
    (id) => typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );

  if (clean.length === 0)
    return NextResponse.json({ error: "no entries selected" }, { status: 400 });

  // collect object keys before the rows disappear
  const { rows: doomed } = await db.query<{
    id: string;
    media_uri: string | null;
    thumb_uri: string | null;
  }>(
    `SELECT id, media_uri, thumb_uri FROM entries
      WHERE id = ANY($1::uuid[]) AND user_id = $2 AND deleted_at IS NOT NULL`,
    [clean, USER_ID]
  );

  if (doomed.length === 0)
    return NextResponse.json(
      { error: "nothing to purge — entries must be in the trash first" },
      { status: 404 }
    );

  const { rowCount } = await db.query(
    `DELETE FROM entries
      WHERE id = ANY($1::uuid[]) AND user_id = $2 AND deleted_at IS NOT NULL`,
    [doomed.map((d) => d.id), USER_ID]
  );

  let objects = 0;
  const orphaned: string[] = [];
  for (const d of doomed) {
    for (const key of [d.media_uri, d.thumb_uri]) {
      if (!key) continue;
      try {
        await s3.removeObject(BUCKET, key);
        objects += 1;
      } catch {
        orphaned.push(key);
      }
    }
  }
  if (orphaned.length)
    console.warn(`[vault] purged rows but left ${orphaned.length} object(s):`,
      orphaned.join(", "));

  return NextResponse.json({
    ok: true,
    purged: rowCount ?? 0,
    objects,
    orphaned: orphaned.length,
  });
}
