"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Fact = {
  id: string;
  category: string;
  fact: string;
  source: string;
  since: string;
};

type Thread = {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  source_entry_id: string | null;
  opened: string;
  age_days: number;
};

const CAT_ORDER = ["goal", "value", "person", "preference", "sensitivity", "context"];
const CAT_LABEL: Record<string, string> = {
  goal: "Goals",
  value: "Values",
  person: "People",
  preference: "Preferences",
  sensitivity: "Sensitivities",
  context: "Context",
};

export default function ProfilePage() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [newFact, setNewFact] = useState("");
  const [newCat, setNewCat] = useState("context");
  const [newThread, setNewThread] = useState("");

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/threads").then((r) => r.json()),
    ]);
    setFacts(p.facts);
    setThreads(t.threads);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addFact = async () => {
    if (!newFact.trim()) return;
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: newCat, fact: newFact }),
    });
    setNewFact("");
    load();
  };

  const delFact = async (id: string) => {
    await fetch(`/api/profile/${id}`, { method: "DELETE" });
    load();
  };

  const addThread = async () => {
    if (!newThread.trim()) return;
    await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newThread }),
    });
    setNewThread("");
    load();
  };

  const setThreadStatus = async (id: string, status: string) => {
    await fetch(`/api/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const byCat = new Map<string, Fact[]>();
  for (const f of facts) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category)!.push(f);
  }
  const open = threads.filter((t) => t.status === "open");
  const closed = threads.filter((t) => t.status !== "open").slice(0, 10);

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Operator Profile</h1>
        <span className="label">
          everything the agent knows about you — yours to correct
        </span>
      </div>
      <p className="mb-8 max-w-prose text-sm" style={{ color: "var(--dim)" }}>
        The agent builds this from your entries and reads it before every live
        session. Delete anything wrong or unwelcome; add what it should know.
        Nothing here is hidden from you.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel self-start">
          <div className="panel-hd" style={{ padding: "12px 14px 9px", margin: 0 }}><span className="label">
            Open Threads · {open.length}
          </span></div>
          <div className="flex flex-col gap-1 px-4 py-3">
            {open.length === 0 && (
              <p className="label">No open loops — the log is settled.</p>
            )}
            {open.map((t) => (
              <div key={t.id} className="loop">
                <span className="top">
                  <span className="label" style={{ color: "var(--cyan)" }}>▸</span>
                  <span className="nm">{t.title}</span>
                  <span className="spacer" />
                  <span className="age">{t.age_days}d</span>
                  <button className="chip ok" style={{ cursor: "pointer", background: "none" }}
                    onClick={() => setThreadStatus(t.id, "resolved")} title="Mark resolved">
                    ✓
                  </button>
                  <button className="chip dim" style={{ cursor: "pointer", background: "none" }}
                    onClick={() => setThreadStatus(t.id, "dropped")} title="Drop — stop following up">
                    ✕
                  </button>
                </span>
                {t.detail && <span className="why">{t.detail}</span>}
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <input
                value={newThread}
                onChange={(e) => setNewThread(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addThread()}
                placeholder="Add an open loop to follow up…"
                className="mono flex-1 px-3 py-1.5 text-sm outline-none"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)", color: "var(--text-bright)" }}
              />
              <button className="btn" style={{ padding: ".3em .9em" }} onClick={addThread}>
                Add
              </button>
            </div>
            {closed.length > 0 && (
              <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--line-dim)" }}>
                <span className="label">recently closed</span>
                {closed.map((t) => (
                  <div key={t.id} className="flex items-baseline gap-3 py-1 text-sm" style={{ color: "var(--dim)" }}>
                    <span className="mono text-xs">{t.status === "resolved" ? "✓" : "✕"}</span>
                    <span className="line-through">{t.title}</span>
                    <button
                      className="label ml-auto"
                      style={{ cursor: "pointer", background: "none", border: "none" }}
                      onClick={() => setThreadStatus(t.id, "open")}
                    >
                      reopen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel self-start">
          <div className="panel-hd" style={{ padding: "12px 14px 9px", margin: 0 }}><span className="label">
            Rapport Profile · {facts.length}
          </span></div>
          <div className="px-4 py-3">
            {facts.length === 0 && (
              <p className="label">
                Empty — the agent is still getting to know you. Facts appear
                here as entries are indexed.
              </p>
            )}
            {CAT_ORDER.filter((c) => byCat.has(c)).map((cat) => (
              <div key={cat} className="mb-3">
                <span className="label" style={{ color: "var(--cyan)" }}>
                  {CAT_LABEL[cat]}
                </span>
                {byCat.get(cat)!.map((f) => (
                  <div key={f.id} className="flex items-baseline gap-2 py-1 text-sm">
                    <span style={{ color: "var(--text)" }}>{f.fact}</span>
                    <span className="label ml-auto whitespace-nowrap">
                      {f.source === "user" ? "you" : "agent"} · {f.since}
                    </span>
                    <button
                      className="mono text-xs"
                      style={{ color: "var(--dim)", cursor: "pointer", background: "none", border: "none" }}
                      onClick={() => delFact(f.id)}
                      aria-label="Remove fact"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ))}
            <div className="mt-3 flex gap-2">
              <select
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                className="mono px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)", color: "var(--text)" }}
              >
                {CAT_ORDER.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                value={newFact}
                onChange={(e) => setNewFact(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFact()}
                placeholder="Tell the agent something it should know…"
                className="mono flex-1 px-3 py-1.5 text-sm outline-none"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)", color: "var(--text-bright)" }}
              />
              <button className="btn" style={{ padding: ".3em .9em" }} onClick={addFact}>
                Add
              </button>
            </div>
          </div>
        </section>
      </div>

      <p className="label mt-6">
        Threads and facts are extracted automatically after each entry is
        indexed. The agent weaves at most one or two open threads into a
        session — see <Link href="/live">Live</Link>.
      </p>
    </div>
  );
}
