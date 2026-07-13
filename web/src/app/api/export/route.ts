import { NextResponse } from "next/server";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { db, USER_ID } from "@/lib/db";
import { s3, BUCKET } from "@/lib/s3";

export const runtime = "nodejs";

function extFor(mime: string | null) {
  if (!mime) return "bin";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return mime.split("/")[1]?.split(";")[0] ?? "bin";
}

export async function GET() {
  const { rows: entries } = await db.query(
    `SELECT e.*,
       (SELECT json_agg(json_build_object(
          'idx', s.idx, 't_start', s.t_start, 't_end', s.t_end,
          'speaker', s.speaker, 'text', s.text) ORDER BY s.idx)
        FROM segments s WHERE s.entry_id = e.id) AS segments,
       (SELECT json_agg(json_build_object(
          'type', a.type, 'source', a.source, 'label', a.label,
          'note', a.note, 't_start', a.t_start))
        FROM annotations a WHERE a.entry_id = e.id AND a.deleted_at IS NULL) AS annotations,
       (SELECT json_agg(json_build_object('name', c.name, 'kind', c.kind))
        FROM entry_concepts ec JOIN concepts c ON c.id = ec.concept_id
        WHERE ec.entry_id = e.id) AS concepts
     FROM entries e
     WHERE e.user_id = $1 AND e.deleted_at IS NULL AND e.status <> 'sealed'
     ORDER BY e.recorded_at`,
    [USER_ID]
  );

  const archive = new ZipArchive({ zlib: { level: 1 } });
  const out = new PassThrough();
  archive.pipe(out);

  // Assemble asynchronously while the response streams
  (async () => {
    try {
      const manifest = entries.map((e) => {
        const { embedding: _e, ts: _t, ...rest } = e;
        return rest;
      });
      archive.append(JSON.stringify(manifest, null, 2), {
        name: "memento-export.json",
      });

      for (const e of entries) {
        const sol = String(e.sol).padStart(3, "0");
        const base = `SOL${sol}-${String(e.recorded_at.toISOString()).slice(0, 10)}-${e.id.slice(0, 8)}`;
        const segs = (e.segments ?? []) as {
          t_start: number; speaker: string; text: string;
        }[];
        if (segs.length) {
          const txt = [
            `${e.title ?? "Untitled"}`,
            `SOL ${sol} · ${e.recorded_at.toISOString()} · mood: ${e.mood ?? "-"}`,
            e.summary ? `\n${e.summary}\n` : "",
            ...segs.map(
              (s) =>
                `[${String(Math.floor(s.t_start / 60)).padStart(2, "0")}:${String(
                  Math.floor(s.t_start % 60)
                ).padStart(2, "0")}] ${s.speaker === "agent" ? "MEMENTO: " : ""}${s.text}`
            ),
          ].join("\n");
          archive.append(txt, { name: `transcripts/${base}.txt` });
        }
        if (e.media_uri) {
          const stream = await s3.getObject(BUCKET, e.media_uri);
          archive.append(stream, {
            name: `media/${base}.${extFor(e.media_mime)}`,
          });
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Readable.toWeb(out) as never, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="memento-export-${stamp}.zip"`,
    },
  });
}
