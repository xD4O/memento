import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { db, USER_ID } from "@/lib/db";
import { s3, BUCKET } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const { rows } = await db.query(
    `SELECT thumb_uri FROM entries
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  if (!rows[0]?.thumb_uri)
    return NextResponse.json({ error: "no thumbnail" }, { status: 404 });

  const stream = await s3.getObject(BUCKET, rows[0].thumb_uri);
  return new NextResponse(Readable.toWeb(stream) as never, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
