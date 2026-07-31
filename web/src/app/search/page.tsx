"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Hit = {
  entry_id: string;
  idx: number;
  t_start: number;
  text: string;
  title: string | null;
  sol: number;
  kind: string;
  recorded_at: string;
  distance?: number;
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** One result, linked to the exact second it was said. */
function ResultRow({ hit: h, related }: { hit: Hit; related?: boolean }) {
  return (
    <Link
      href={`/entry/${h.entry_id}?t=${Math.max(0, Math.floor(h.t_start))}`}
      className="panel block px-4 py-3 transition-colors hover:border-[var(--line)]"
      style={related ? { borderLeft: "2px solid var(--cyan)" } : undefined}
    >
      <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className="mono text-xs"
          style={{ color: "var(--amber)", letterSpacing: ".15em" }}
        >
          SOL {String(h.sol).padStart(3, "0")}
        </span>
        <span className="text-sm" style={{ color: "var(--text-bright)" }}>
          {h.title ?? "Untitled entry"}
        </span>
        <span className="mono ml-auto text-xs" style={{ color: "var(--cyan)" }}>
          ▶ {fmtTime(h.t_start)}
        </span>
      </span>
      <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>
        “{h.text}”
      </p>
    </Link>
  );
}

type Source = {
  n: number;
  sol: number;
  title: string | null;
  entry_id: string;
  t: number;
  when: string;
};

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Hit[]>([]);
  const [related, setRelated] = useState<Hit[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [mode, setMode] = useState<"find" | "ask">("find");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [asking, setAsking] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ask = async () => {
    if (q.trim().length < 3 || asking) return;
    setAsking(true);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnswer(data.answer);
        setSources(data.sources);
      } else {
        setAnswer(data.error ?? "Something went wrong.");
      }
    } finally {
      setAsking(false);
    }
  };

  useEffect(() => {
    if (mode !== "find") return;
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setMatches([]);
      setRelated([]);
      setSearched(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setMatches(data.matches ?? []);
        setRelated(data.related ?? []);
        setDegraded(data.degraded);
        setSearched(true);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, mode]);

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Memory Search</h1>
        <span className="label">semantic + keyword across all transcripts</span>
        <span className="ml-auto flex gap-2">
          <button
            className={mode === "find" ? "chip" : "chip dim"}
            style={{ cursor: "pointer", background: "none" }}
            onClick={() => setMode("find")}
          >
            Find
          </button>
          <button
            className={mode === "ask" ? "chip cyan" : "chip dim"}
            style={{ cursor: "pointer", background: "none" }}
            onClick={() => setMode("ask")}
          >
            Ask
          </button>
        </span>
      </div>

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => mode === "ask" && e.key === "Enter" && ask()}
        placeholder={
          mode === "ask"
            ? "Ask your journal anything — answers cite the exact moments…"
            : "What are you trying to remember?"
        }
        className="mono w-full px-4 py-3 text-base outline-none"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          color: "var(--text-bright)",
        }}
      />

      {mode === "ask" && (
        <div className="mt-5 flex flex-col gap-3">
          <button className="btn self-start" onClick={ask} disabled={asking || q.trim().length < 3}>
            {asking ? "Consulting the log…" : "▸ Ask"}
          </button>
          {answer && (
            <div className="panel px-5 py-4">
              <p style={{ color: "var(--text-bright)", maxWidth: "68ch" }}>{answer}</p>
              {sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--line-dim)" }}>
                  {sources.map((s) => (
                    <Link
                      key={s.n}
                      href={`/entry/${s.entry_id}?t=${s.t}`}
                      className="chip dim"
                      style={{ textDecoration: "none" }}
                    >
                      [{s.n}] SOL {String(s.sol).padStart(3, "0")} ·{" "}
                      {(s.title ?? "untitled").slice(0, 28)} ▶
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2" style={{ display: mode === "ask" ? "none" : undefined }}>
        {searching && <span className="label pulse">Searching the log…</span>}
        {degraded && searched && (
          <span className="label" style={{ color: "var(--red)" }}>
            Semantic search offline (Ollama unreachable) — keyword results only.
          </span>
        )}
        {searched && !searching && matches.length === 0 && related.length === 0 && (
          <span className="label">No matches on record.</span>
        )}

        {matches.map((h) => (
          <ResultRow key={`m:${h.entry_id}:${h.idx}`} hit={h} />
        ))}

        {searched && !searching && related.length > 0 && (
          <>
            <span
              className="mono mt-4 text-xs"
              style={{ color: "var(--dim)", letterSpacing: ".15em" }}
            >
              SIMILAR TOPICS ·{" "}
              {matches.length === 0
                ? "nothing in the log uses that word — closest in meaning"
                : "close in meaning, different words"}
            </span>
            {related.map((h) => (
              <ResultRow key={`r:${h.entry_id}:${h.idx}`} hit={h} related />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
