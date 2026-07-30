import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 600;

// one render at a time — the GPU is shared with the indexing pipeline
let busy: Promise<void> = Promise.resolve();

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env });
    p.on("close", (code) => resolve(code ?? 1));
    p.on("error", () => resolve(1));
  });
}

export async function POST(req: NextRequest) {
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length < 2000)
    return NextResponse.json({ error: "audio too short" }, { status: 400 });

  const afDir = process.env.AVATARFORCING_DIR;
  if (!afDir)
    return NextResponse.json({ error: "avatar renderer not configured" }, { status: 501 });

  const td = await mkdtemp(path.join(tmpdir(), "avatar-req-"));
  const input = path.join(td, "utterance.webm");
  const output = path.join(td, "clip.mp4");
  try {
    await writeFile(input, body);

    let release!: () => void;
    const prev = busy;
    busy = new Promise((r) => (release = r));
    await prev;

    try {
      // warm daemon first (models stay loaded); subprocess is the cold fallback
      try {
        const res = await fetch("http://127.0.0.1:8745/render", {
          method: "POST",
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(240_000),
        });
        if (res.status === 204)
          return new NextResponse(null, { status: 204 });
        if (res.ok) {
          const clip = Buffer.from(await res.arrayBuffer());
          return new NextResponse(new Uint8Array(clip), {
            status: 200,
            headers: { "Content-Type": "video/mp4", "Content-Length": String(clip.length) },
          });
        }
      } catch (e) {
        console.warn(`[avatar] daemon fetch failed: ${e instanceof Error ? e.message : e} — using subprocess`);
      }
      const code = await run(
        `${afDir}/.venv/bin/python`,
        [
          path.join(process.cwd(), "..", "scripts", "render_avatar.py"),
          input,
          output,
        ],
        {
          ...process.env,
          AVATARFORCING_DIR: afDir,
          NARRATOR_REF:
            process.env.NARRATOR_REF ??
            path.join(process.cwd(), "..", "assets", "narrator.jpg"),
        }
      );
      if (code === 3)
        return new NextResponse(null, { status: 204 });
      if (code !== 0) {
        console.warn(`[avatar] subprocess render failed with code ${code}`);
        return NextResponse.json({ error: `render failed (${code})` }, { status: 500 });
      }
      const clip = await readFile(output);
      return new NextResponse(new Uint8Array(clip), {
        status: 200,
        headers: { "Content-Type": "video/mp4", "Content-Length": String(clip.length) },
      });
    } finally {
      release();
    }
  } finally {
    rm(td, { recursive: true, force: true }).catch(() => {});
  }
}
