import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { db, USER_ID } from "@/lib/db";
import { s3, BUCKET } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ week: string }> }
) {
  const { week } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week))
    return NextResponse.json({ error: "bad week" }, { status: 400 });
  const { rows } = await db.query(
    `SELECT recap_uri FROM weekly_summaries WHERE user_id = $1 AND week_start = $2`,
    [USER_ID, week]
  );
  if (!rows[0]?.recap_uri)
    return NextResponse.json({ error: "no recap" }, { status: 404 });

  const stat = await s3.statObject(BUCKET, rows[0].recap_uri);
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      const stream = await s3.getPartialObject(
        BUCKET, rows[0].recap_uri, start, end - start + 1
      );
      return new NextResponse(Readable.toWeb(stream) as never, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
  }
  const stream = await s3.getObject(BUCKET, rows[0].recap_uri);
  return new NextResponse(Readable.toWeb(stream) as never, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
}
