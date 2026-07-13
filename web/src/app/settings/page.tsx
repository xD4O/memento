"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [vision, setVision] = useState(true);
  const [theme, setTheme] = useState("amber");
  const [voice, setVoice] = useState("marin");
  const [voices, setVoices] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<string>("");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);

  const THEME_META: Record<string, { label: string; swatch: string }> = {
    amber: { label: "Terminal Amber", swatch: "#FFB454" },
    cryo: { label: "Cryo Cyan", swatch: "#59D2DE" },
    botanic: { label: "Botanic", swatch: "#8FD97C" },
    nebula: { label: "Nebula", swatch: "#B48CFF" },
  };
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((d) => {
        setName(d.name ?? "");
        setVision(d.vision !== false);
        setTheme(d.theme ?? "amber");
        setVoice(d.voice ?? "marin");
        setVoices(d.voices ?? []);
        setModel(d.realtime_model ?? "");
        setKeyStatus(
          d.has_key_override
            ? `override active (…${d.key_tail})`
            : d.env_key_present
              ? "using server .env key"
              : "no key configured"
        );
      });
  }, []);

  const pickTheme = async (t: string) => {
    setTheme(t);
    document.documentElement.dataset.theme = t === "amber" ? "" : t;
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: t }),
    });
  };

  const saveVoice = async () => {
    setVoiceMsg(null);
    const calls: Promise<Response>[] = [
      fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      }),
      fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realtimeModel: model }),
      }),
    ];
    if (keyInput.trim() !== "" || keyInput === "") {
      // empty string only clears when the user typed then erased — send only if touched
    }
    const results = await Promise.all(calls);
    let keyNote = "";
    if (keyInput.trim() !== "") {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiKey: keyInput.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setVoiceMsg(d.error ?? "Key rejected.");
        return;
      }
      keyNote = " · key saved";
      setKeyInput("");
      setKeyStatus(`override active (…${keyInput.trim().slice(-4)})`);
    }
    setVoiceMsg(
      results.every((r) => r.ok)
        ? `Saved — takes effect on the next session.${keyNote}`
        : "Save failed."
    );
  };

  const clearKey = async () => {
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openaiKey: "" }),
    });
    setKeyStatus("using server .env key");
    setVoiceMsg("Key override cleared — back to the server .env key.");
  };

  const toggleVision = async () => {
    const next = !vision;
    setVision(next);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visionEnabled: next }),
    });
  };

  const saveName = async () => {
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    setNameMsg(res.ok ? "Saved — the HUD uses this name." : "Save failed.");
    setTimeout(() => setNameMsg(null), 4000);
  };

  const changePass = async () => {
    if (busy) return;
    if (next !== confirm) {
      setPassMsg({ ok: false, text: "New passphrases don't match." });
      return;
    }
    setBusy(true);
    setPassMsg(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const d = await res.json();
      if (res.ok) {
        setPassMsg({ ok: true, text: "Passphrase changed. Existing sessions stay signed in." });
        setCurrent(""); setNext(""); setConfirm("");
      } else {
        setPassMsg({ ok: false, text: d.error ?? "Change failed." });
      }
    } finally {
      setBusy(false);
    }
  };

  const field = {
    background: "var(--panel-2)",
    border: "1px solid var(--line-dim)",
    color: "var(--text-bright)",
  } as const;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-10">
      <div className="mb-8 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          Terminal Settings
        </span>
      </div>

      <section className="panel mb-6 px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Operator Name
        </div>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mono flex-1 px-3 py-2 text-sm outline-none"
            style={field}
            placeholder="shown on the HUD: LOG ENTRY > NAME"
          />
          <button className="btn" onClick={saveName}>Save</button>
        </div>
        {nameMsg && <p className="label mt-2">{nameMsg}</p>}
      </section>

      <section className="panel mb-6 px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Theme
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(THEME_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => pickTheme(key)}
              className="mono flex items-center gap-2 px-3 py-2 text-xs"
              style={{
                background: "var(--panel-2)",
                border: `1px solid ${theme === key ? meta.swatch : "var(--line-dim)"}`,
                color: theme === key ? "var(--text-bright)" : "var(--dim)",
                cursor: "pointer",
                letterSpacing: ".12em",
              }}
            >
              <span
                className="inline-block h-3 w-3"
                style={{ background: meta.swatch, borderRadius: 2 }}
              />
              {meta.label.toUpperCase()}
              {theme === key && " ✓"}
            </button>
          ))}
        </div>
        <p className="label mt-3">applies instantly, everywhere, on every device</p>
      </section>

      <section className="panel mb-6 px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Voice Agent
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="label">voice</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="mono px-3 py-2 text-sm outline-none"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)", color: "var(--text-bright)" }}
            >
              {voices.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">realtime model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-realtime"
              className="mono px-3 py-2 text-sm outline-none"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)", color: "var(--text-bright)" }}
            />
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className="label">openai api key · {keyStatus}</span>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-… (leave blank to keep current)"
              autoComplete="off"
              className="mono flex-1 px-3 py-2 text-sm outline-none"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)", color: "var(--text-bright)" }}
            />
            {keyStatus.startsWith("override") && (
              <button className="chip dim" style={{ cursor: "pointer", background: "none" }} onClick={clearKey}>
                clear override
              </button>
            )}
          </div>
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn" onClick={saveVoice}>▸ Save Voice Settings</button>
          {voiceMsg && <span className="label">{voiceMsg}</span>}
        </div>
        <p className="label mt-3" style={{ maxWidth: "56ch" }}>
          The key is stored in your local database and used only by this
          server to mint ephemeral session tokens — it is never sent to the
          browser.
        </p>
      </section>

      <section className="panel mb-6 px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Vision Analysis
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={vision} onChange={toggleVision} style={{ accentColor: "var(--amber)" }} />
          Let the indexing pass look at video frames (scene, appearance, energy).
          Runs entirely on the DGX; appears as the Visual Log line on entries.
        </label>
      </section>

      <section className="panel px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Change Passphrase
        </div>
        <div className="flex flex-col gap-2">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
            placeholder="current passphrase" autoComplete="current-password"
            className="mono px-3 py-2 text-sm outline-none" style={field} />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
            placeholder="new passphrase (min 8 characters)" autoComplete="new-password"
            className="mono px-3 py-2 text-sm outline-none" style={field} />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePass()}
            placeholder="repeat new passphrase" autoComplete="new-password"
            className="mono px-3 py-2 text-sm outline-none" style={field} />
          <button className="btn mt-1 self-start" onClick={changePass} disabled={busy}>
            {busy ? "Changing…" : "▸ Change Passphrase"}
          </button>
          {passMsg && (
            <p className="text-sm" style={{ color: passMsg.ok ? "var(--cyan)" : "var(--red)" }}>
              {passMsg.text}
            </p>
          )}
        </div>
        <p className="label mt-4" style={{ maxWidth: "52ch" }}>
          Stored as a scrypt hash on your own hardware. If you forget it, reset
          from the DGX shell — see README → Security.
        </p>
      </section>
    </main>
  );
}
