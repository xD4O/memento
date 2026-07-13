"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Pin = {
  id: string;
  kind: string;
  text: string;
  due_on: string | null;
  status: string;
  source: string;
  source_entry_id: string | null;
  created: string;
  overdue: boolean;
  due_today: boolean;
};

export default function PinsPage() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/pins");
    setPins((await res.json()).pins);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!text.trim()) return;
    await fetch("/api/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, due: due || null }),
    });
    setText("");
    setDue("");
    load();
  };

  const setStatus = async (id: string, status: string) => {
    await fetch(`/api/pins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const active = pins.filter((p) => p.status === "active");
  const overdue = active.filter((p) => p.overdue);
  const upcoming = active.filter((p) => !p.overdue && p.due_on);
  const notes = active.filter((p) => !p.due_on);
  const closed = pins.filter((p) => p.status !== "active");

  const Row = ({ p }: { p: Pin }) => (
    <div
      className="flex items-baseline gap-3 border-b py-2 last:border-0"
      style={{ borderColor: "var(--line-dim)" }}
    >
      <span
        className="mono text-xs"
        style={{
          color: p.overdue
            ? "var(--red)"
            : p.kind === "reminder"
              ? "var(--amber)"
              : "var(--cyan)",
        }}
      >
        {p.kind === "reminder" ? "◪" : "▤"}
      </span>
      <span className="min-w-0 flex-1" style={{ color: "var(--text-bright)" }}>
        {p.text}
        {p.source_entry_id && (
          <Link
            href={`/entry/${p.source_entry_id}`}
            className="label ml-2"
            style={{ borderBottom: "none" }}
          >
            ↳ source
          </Link>
        )}
      </span>
      {p.due_on && (
        <span
          className="mono text-xs whitespace-nowrap"
          style={{
            color: p.overdue ? "var(--red)" : p.due_today ? "var(--amber)" : "var(--dim)",
          }}
        >
          {p.overdue ? "OVERDUE · " : p.due_today ? "TODAY · " : ""}
          {p.due_on}
        </span>
      )}
      <span className="label">{p.source}</span>
      <button className="chip cyan" style={{ cursor: "pointer", background: "none" }}
        onClick={() => setStatus(p.id, "done")} title="Mark done">
        ✓
      </button>
      <button className="chip dim" style={{ cursor: "pointer", background: "none" }}
        onClick={() => setStatus(p.id, "dismissed")} title="Dismiss">
        ✕
      </button>
    </div>
  );

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24 pt-10">
      <div className="mb-2 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          Pinboard
        </span>
        <span className="label">
          say “remind me…” or “pin that” in any entry or session — it lands here
        </span>
      </div>

      <div className="mb-6 mt-4 flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Pin a reminder or note…"
          className="mono min-w-64 flex-1 px-3 py-2 text-sm outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text-bright)" }}
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="mono px-3 py-2 text-sm outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line-dim)", color: "var(--text)", colorScheme: "dark" }}
        />
        <button className="btn" onClick={add}>
          ◪ Pin It
        </button>
      </div>

      {overdue.length > 0 && (
        <section className="panel mb-4" style={{ borderColor: "rgba(229,72,77,.4)" }}>
          <div className="label px-4 py-2.5" style={{ borderBottom: "1px solid var(--line-dim)", color: "var(--red)" }}>
            Overdue · {overdue.length}
          </div>
          <div className="px-4 py-1">{overdue.map((p) => <Row key={p.id} p={p} />)}</div>
        </section>
      )}

      <section className="panel mb-4">
        <div className="label px-4 py-2.5" style={{ borderBottom: "1px solid var(--line-dim)", color: "var(--amber)" }}>
          Upcoming Reminders · {upcoming.length}
        </div>
        <div className="px-4 py-1">
          {upcoming.length === 0 && <p className="label py-2">Nothing scheduled.</p>}
          {upcoming.map((p) => <Row key={p.id} p={p} />)}
        </div>
      </section>

      <section className="panel mb-4">
        <div className="label px-4 py-2.5" style={{ borderBottom: "1px solid var(--line-dim)", color: "var(--cyan)" }}>
          Notes · {notes.length}
        </div>
        <div className="px-4 py-1">
          {notes.length === 0 && <p className="label py-2">No pinned notes.</p>}
          {notes.map((p) => <Row key={p.id} p={p} />)}
        </div>
      </section>

      {closed.length > 0 && (
        <section className="panel">
          <div className="label px-4 py-2.5" style={{ borderBottom: "1px solid var(--line-dim)" }}>
            Recently Closed
          </div>
          <div className="px-4 py-1">
            {closed.map((p) => (
              <div key={p.id} className="flex items-baseline gap-3 py-1.5 text-sm" style={{ color: "var(--dim)" }}>
                <span className="mono text-xs">{p.status === "done" ? "✓" : "✕"}</span>
                <span className="line-through">{p.text}</span>
                <button
                  className="label ml-auto"
                  style={{ cursor: "pointer", background: "none", border: "none" }}
                  onClick={() => setStatus(p.id, "active")}
                >
                  restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
