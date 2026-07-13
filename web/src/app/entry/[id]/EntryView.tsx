"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HudOverlay from "@/components/HudOverlay";

type Segment = {
  idx: number;
  t_start: number;
  t_end: number;
  speaker: string;
  text: string;
};

type Annotation = {
  id: string;
  type: string;
  source: string;
  label: string;
  note: string | null;
  t_start: number | null;
};

const ANNOTATION_ICON: Record<string, string> = {
  flag: "⚑",
  highlight: "★",
  action_item: "▸",
  insight: "◆",
};

type Entry = {
  id: string;
  kind: string;
  status: string;
  recorded_at: string;
  sol: number;
  duration_s: number | null;
  title: string | null;
  summary: string | null;
  mood: string | null;
  media_mime: string | null;
  entry_no: number;
  user_name: string | null;
  cost_usd: number | null;
  vision: { scene?: string; appearance?: string; energy?: string; notes?: string } | null;
  error: string | null;
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const PENDING = new Set(["created", "uploaded", "transcribing"]);

export default function EntryView({
  id,
  initialT = 0,
}: {
  id: string;
  initialT?: number;
}) {
  const seekedRef = useRef(false);
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/entries/${id}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return null;
    }
    const data = await res.json();
    setEntry(data.entry);
    setSegments(data.segments);
    setAnnotations(data.annotations ?? []);
    return data.entry as Entry;
  }, [id]);

  const flagSegment = async (s: Segment) => {
    const label = window.prompt(
      "Flag label:",
      s.text.split(/\s+/).slice(0, 6).join(" ")
    );
    if (!label?.trim()) return;
    await fetch(`/api/entries/${id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segment_idx: s.idx, type: "flag", label }),
    });
    load();
  };

  const removeAnnotation = async (aid: string) => {
    await fetch(`/api/annotations/${aid}`, { method: "DELETE" });
    load();
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      const e = await load();
      if (!stopped && e && PENDING.has(e.status)) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const onLoadedMetadata = () => {
    if (initialT > 0 && !seekedRef.current && videoRef.current) {
      seekedRef.current = true;
      videoRef.current.currentTime = initialT;
    }
  };

  const onTimeUpdate = () => {
    const t = videoRef.current?.currentTime ?? 0;
    const i = segments.findIndex((s) => t >= s.t_start && t < s.t_end);
    if (i !== activeIdx) {
      setActiveIdx(i);
      activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  const seek = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.play().catch(() => {});
    }
  };

  const del = async () => {
    if (
      !confirm(
        "Delete this log entry? It will be removed from your journal. " +
          "(Soft delete — the media file is retained in storage and backups.)"
      )
    )
      return;
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    router.push("/");
  };

  if (notFound)
    return (
      <main className="mx-auto max-w-4xl px-5 pt-16">
        <p className="mono" style={{ color: "var(--red)" }}>ENTRY NOT FOUND</p>
      </main>
    );

  if (!entry)
    return (
      <main className="mx-auto max-w-4xl px-5 pt-16">
        <p className="label pulse">Retrieving entry…</p>
      </main>
    );

  const pending = PENDING.has(entry.status);
  const hasMedia = !!entry.media_mime;
  const isAudioOnly =
    entry.kind === "audio_log" ||
    (entry.kind === "live_session" && entry.media_mime?.startsWith("audio"));
  const transcriptOnly = entry.kind === "live_session" && !hasMedia;

  return (
    <main className="mx-auto max-w-5xl px-5 pb-24 pt-8">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="mono text-xs" style={{ color: "var(--amber)", letterSpacing: ".15em" }}>
          SOL {String(entry.sol).padStart(3, "0")}
        </span>
        <h1 className="flex-1 truncate text-lg" style={{ color: "var(--text-bright)" }}>
          {entry.title ?? "Untitled entry"}
        </h1>
        <span className="label">
          {entry.recorded_at.slice(0, 16).replace("T", " ")}Z
        </span>
        {entry.status === "indexed" ? (
          <span className="chip dim">indexed</span>
        ) : entry.status === "error" ? (
          <span className="chip red">error</span>
        ) : (
          <span className="chip pulse">{entry.status}</span>
        )}
        <button className="btn danger" onClick={del} style={{ padding: ".35em .8em" }}>
          ✕ Delete Entry
        </button>
      </div>

      {entry.vision?.scene && (
        <p className="mb-3 text-sm" style={{ color: "var(--dim)" }}>
          <span className="label mr-2" style={{ color: "var(--cyan)" }}>
            Visual Log
          </span>
          {[entry.vision.scene, entry.vision.appearance, entry.vision.energy && `energy: ${entry.vision.energy}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {(entry.summary || entry.mood) && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {entry.mood && <span className="chip cyan">{entry.mood}</span>}
          {entry.summary && (
            <p className="m-0 text-sm" style={{ color: "var(--dim)" }}>
              {entry.summary}
            </p>
          )}
        </div>
      )}

      {annotations.length > 0 && (
        <div className="panel mb-4 px-4 py-3">
          <div className="label mb-2" style={{ color: "var(--amber)" }}>
            Flagged Moments
          </div>
          <ul className="flex flex-col gap-1.5">
            {annotations.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-sm">
                <span className="mono" style={{ color: a.source === "agent" ? "var(--amber)" : "var(--cyan)" }}>
                  {ANNOTATION_ICON[a.type] ?? "⚑"}
                </span>
                <span style={{ color: "var(--text-bright)" }}>{a.label}</span>
                <span className="chip dim">{a.type.replace("_", " ")}</span>
                <span className="label">{a.source}</span>
                {a.t_start != null && (hasMedia || entry.kind !== "live_session") && (
                  <button
                    className="mono text-xs"
                    style={{ color: "var(--cyan)", cursor: "pointer", background: "none", border: "none" }}
                    onClick={() => seek(a.t_start!)}
                  >
                    ▶ {fmtTime(a.t_start)}
                  </button>
                )}
                <button
                  className="ml-auto mono text-xs"
                  style={{ color: "var(--dim)", cursor: "pointer", background: "none", border: "none" }}
                  onClick={() => removeAnnotation(a.id)}
                  aria-label={`Remove ${a.label}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={transcriptOnly ? "" : "grid gap-4 lg:grid-cols-[1.6fr_1fr]"}>
        {transcriptOnly ? null : isAudioOnly ? (
          <div className="panel flex flex-col items-center gap-5 self-start px-6 py-10">
            <span className="mono" style={{ color: "var(--cyan)", letterSpacing: ".2em" }}>
              ◉ AUDIO LOG
            </span>
            <video
              ref={videoRef}
              src={`/api/entries/${id}/media`}
              controls
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              className="w-full"
              style={{ height: "54px" }}
            />
          </div>
        ) : (
          <div className="panel relative overflow-hidden" style={{ aspectRatio: "16/9", alignSelf: "start" }}>
            <video
              ref={videoRef}
              src={`/api/entries/${id}/media`}
              controls
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              className="h-full w-full object-contain"
            />
            <HudOverlay
              sol={entry.sol}
              entryNo={entry.entry_no}
              time={new Date(entry.recorded_at).toTimeString().slice(0, 5)}
              userName={entry.user_name ?? "USER"}
              bottomOffset="3.5rem"
            />
          </div>
        )}

        <div className="panel flex max-h-[70vh] flex-col">
          <div
            className="label px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--line-dim)", color: "var(--amber)" }}
          >
            Transcript
          </div>
          <div className="flex-1 overflow-y-auto">
            {pending && (
              <p className="label pulse px-4 py-6">
                {entry.status === "transcribing"
                  ? "Transcribing aboard the DGX…"
                  : "Awaiting the transcription worker…"}
              </p>
            )}
            {entry.status === "error" && (
              <p className="px-4 py-6 text-sm" style={{ color: "var(--red)" }}>
                Transcription failed: {entry.error ?? "unknown error"}
              </p>
            )}
            {segments.map((s, i) => (
              <div
                key={s.idx}
                className={`transcript-seg group flex w-full items-baseline px-4 py-2 text-left text-sm ${
                  i === activeIdx ? "active" : ""
                }`}
              >
                <button
                  ref={i === activeIdx ? activeRef : undefined}
                  onClick={() => hasMedia && seek(s.t_start)}
                  className="flex-1 text-left"
                  style={{ background: "none", border: "none", cursor: hasMedia ? "pointer" : "default" }}
                >
                  <span className="seg-time mono mr-3 text-xs" style={{ color: "var(--dim)" }}>
                    {fmtTime(s.t_start)}
                  </span>
                  {entry.kind === "live_session" && (
                    <span
                      className="mono mr-2 text-xs"
                      style={{
                        color: s.speaker === "agent" ? "var(--amber)" : "var(--cyan)",
                        letterSpacing: ".12em",
                      }}
                    >
                      {s.speaker === "agent" ? "MEMENTO" : "YOU"}
                    </span>
                  )}
                  <span style={{ color: s.speaker === "agent" ? "var(--text-bright)" : "var(--text)" }}>
                    {s.text}
                  </span>
                </button>
                <button
                  onClick={() => flagSegment(s)}
                  className="mono ml-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  style={{ color: "var(--amber)", background: "none", border: "none", cursor: "pointer" }}
                  aria-label="Flag this moment"
                  title="Flag this moment"
                >
                  ⚑
                </button>
              </div>
            ))}
            {entry.status === "indexed" && segments.length === 0 && (
              <p className="px-4 py-6 text-sm" style={{ color: "var(--dim)" }}>
                No speech detected in this entry.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
