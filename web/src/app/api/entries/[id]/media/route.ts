import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { db, USER_ID } from "@/lib/db";
import { s3, BUCKET, ensureBucket } from "@/lib/s3";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { rows } = await db.query(
    `SELECT status FROM entries
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, USER_ID]
  );
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["created", "error", "uploaded"].includes(rows[0].status))
    return NextResponse.json({ error: `entry is ${rows[0].status}` }, { status: 409 });
  if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });

  await ensureBucket();
  const key = `${USER_ID}/${id}/original`;
  const mime = req.headers.get("content-type") ?? "application/octet-stream";
  const size = Number(req.headers.get("content-length"));
  const stream = Readable.fromWeb(req.body as never);

  if (Number.isFinite(size) && size > 0) {
    await s3.putObject(BUCKET, key, stream, size, { "Content-Type": mime });
  } else {
    await s3.putObject(BUCKET, key, stream, undefined, { "Content-Type": mime });
  }

  await db.query(
    `UPDATE entries SET media_uri = $1, media_mime = $2,
       status = CASE WHEN deliver_on IS NOT NULL AND deliver_on > current_date
                     THEN 'sealed' ELSE 'uploaded' END,
       error = NULL
     WHERE id = $3`,
    [key, mime, id]
  );
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { rows } = await db.query(
    `SELECT media_uri, media_mime FROM entries
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       AND status <> 'sealed'`,
    [id, USER_ID]
  );
  const media = rows[0];
  if (!media?.media_uri)
    return NextResponse.json({ error: "no media" }, { status: 404 });

  const stat = await s3.statObject(BUCKET, media.media_uri);
  const mime = media.media_mime ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size)
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      const stream = await s3.getPartialObject(
        BUCKET, media.media_uri, start, end - start + 1
      );
      return new NextResponse(Readable.toWeb(stream) as never, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
  }

  const stream = await s3.getObject(BUCKET, media.media_uri);
  return new NextResponse(Readable.toWeb(stream) as never, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
}
