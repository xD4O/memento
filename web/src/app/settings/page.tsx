"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import About from "@/components/About";

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [vision, setVision] = useState(true);
  const [theme, setTheme] = useState("amber");
  const [accent, setAccent] = useState("");
  const [accentMsg, setAccentMsg] = useState<string | null>(null);
  const [signal, setSignal] = useState("");
  const [look, setLook] = useState({
    glow: "subtle",
    edge: "on",
    ground: "void",
    grid: "off",
    density: "comfortable",
    void_field: "stars",
    tempo: "quick",
    pulse: "standard",
  });
  const [voice, setVoice] = useState("marin");
  const [voices, setVoices] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<string>("");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);

  const THEME_META: Record<string, { label: string; swatch: string }> = {
    amber: { label: "Ares Ice", swatch: "#7FD4E8" },
    amberhot: { label: "Terminal Amber", swatch: "#FF9D3D" },
    cryo: { label: "Cryo Cyan", swatch: "#59D2DE" },
    botanic: { label: "Botanic", swatch: "#6EE7A8" },
    nebula: { label: "Nebula", swatch: "#A98CFF" },
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
        setAccent(d.accent ?? "");
        setSignal(d.signal ?? "");
        setLook({
          glow: d.glow ?? "subtle",
          edge: d.edge ?? "on",
          ground: d.ground ?? "void",
          grid: d.grid ?? "off",
          density: d.density ?? "comfortable",
          void_field: d.void_field ?? "stars",
          tempo: d.tempo ?? "quick",
          pulse: d.pulse ?? "standard",
        });
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

  const saveAccent = async (hex: string) => {
    setAccent(hex);
    document.documentElement.style.setProperty("--amber", hex);
    document.documentElement.style.setProperty("--amber-dim", hex + "8c");
    document.documentElement.style.setProperty("--line", hex + "52");
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accent: hex }),
    });
    const d = await res.json().catch(() => ({}));
    setAccentMsg(res.ok ? "Saved — applies everywhere." : (d.error ?? "Save failed."));
  };

  const clearAccent = async () => {
    setAccent("");
    for (const p of ["--amber", "--amber-dim", "--line"])
      document.documentElement.style.removeProperty(p);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accent: "" }),
    });
    setAccentMsg("Back to the preset.");
  };

  // Applied to <html> immediately so the change is visible while it saves.
  // storage key -> the attribute the stylesheet actually reads
  const ATTR: Record<string, string> = { void_field: "void" };

  const setLookOption = async (key: string, value: string) => {
    setLook((prev) => ({ ...prev, [key]: value }));
    document.documentElement.setAttribute(`data-${ATTR[key] ?? key}`, value);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    // the starfield is built server-side from its mode, so swapping between
    // stars and deep needs the tree re-rendered, not just an attribute flip
    if (key === "void_field") router.refresh();
  };

  const saveSignal = async (hex: string) => {
    setSignal(hex);
    document.documentElement.style.setProperty("--cyan", hex);
    document.documentElement.style.setProperty("--hair-warm", hex + "38");
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: hex }),
    });
    setAccentMsg("Saved — applies everywhere.");
  };

  const clearSignal = async () => {
    setSignal("");
    for (const v of ["--cyan", "--hair-warm"])
      document.documentElement.style.removeProperty(v);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "" }),
    });
    setAccentMsg("Signal hue reset.");
  };

  const OPTIONS: { key: string; label: string; hint: string; choices: [string, string][] }[] = [
    { key: "glow", label: "Glow", hint: "How much light the edges throw",
      choices: [["off", "Off"], ["subtle", "Subtle"], ["normal", "Normal"], ["bright", "Bright"]] },
    { key: "edge", label: "Edge motion", hint: "The light that travels the border on hover",
      choices: [["off", "Off"], ["static", "Static"], ["on", "Travelling"]] },
    { key: "ground", label: "Ground", hint: "Base tone behind every panel",
      choices: [["void", "Void"], ["slate", "Slate"], ["carbon", "Carbon"], ["oxide", "Oxide"]] },
    { key: "grid", label: "Grid", hint: "The engineering grid behind the console",
      choices: [["off", "Off"], ["on", "Normal"], ["bold", "Bold"]] },
    { key: "density", label: "Density", hint: "Spacing across every page",
      choices: [["comfortable", "Comfortable"], ["compact", "Compact"]] },
    { key: "void_field", label: "Void", hint: "Parallax starfield behind the console",
      choices: [["off", "Flat"], ["stars", "Stars"], ["deep", "Deep"]] },
    { key: "tempo", label: "Tempo", hint: "How fast the hover glow pulses and the light travels",
      choices: [["calm", "Calm"], ["normal", "Normal"], ["quick", "Quick"]] },
    { key: "pulse", label: "Pulse", hint: "Shape of the glow's rise and fall",
      choices: [["standard", "Standard"], ["smooth", "Smooth"]] },
  ];

  const GROUNDS: [string, string, string][] = [
    ["void", "Void", "#04060a"],
    ["slate", "Slate", "#070b14"],
    ["carbon", "Carbon", "#08090b"],
    ["oxide", "Oxide", "#0a0705"],
  ];
  const FIXED: [string, string][] = [
    ["Alert", "#ff5a5f"],
    ["Healthy", "#6ee7a8"],
    ["Capsule", "#a98cff"],
  ];

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
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Terminal Settings</h1>
        <span className="sub">Local to this machine</span>
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
          <button className="btn" onClick={saveName}>
            Save
          </button>
        </div>
        {nameMsg && <p className="label mt-2">{nameMsg}</p>}
      </section>

      <section className="panel mb-6 px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Theme
        </div>

        <div className="swatch-row">
          {Object.entries(THEME_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => pickTheme(key)}
              className="swatch"
              aria-pressed={theme === key}
              style={{ borderColor: theme === key ? meta.swatch : "var(--line-dim)" }}
            >
              <i style={{ background: meta.swatch }} />
              {meta.label}
              {theme === key ? " ✓" : ""}
            </button>
          ))}
        </div>

        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--line-dim)" }}>
          <div className="label mb-1">Palette</div>
          <p className="label mb-3" style={{ whiteSpace: "normal", opacity: 0.7 }}>
            Click a tile to change it. The last three are fixed so status always reads the same.
          </p>

          <div className="pal">
            <div className="pal-tile" title="Accent — wordmark, streak, Live, Record, glows">
              <span className="sw" style={{ background: accent || "var(--amber)" }} />
              <span className="meta">
                <span className="nm">Accent</span>
                <span className="hex">{accent || "preset"}</span>
              </span>
              <input
                type="color"
                value={accent || "#7fd4e8"}
                onChange={(e) => saveAccent(e.target.value)}
                aria-label="Accent colour"
              />
            </div>

            <div className="pal-tile" title="Signal — capsules, pins, time-capsule actions">
              <span className="sw" style={{ background: signal || "var(--cyan)" }} />
              <span className="meta">
                <span className="nm">Signal</span>
                <span className="hex">{signal || "preset"}</span>
              </span>
              <input
                type="color"
                value={signal || "#ff9d3d"}
                onChange={(e) => saveSignal(e.target.value)}
                aria-label="Signal colour"
              />
            </div>

            {GROUNDS.map(([value, label, hex]) => (
              <button
                key={value}
                className={look.ground === value ? "pal-tile on" : "pal-tile"}
                onClick={() => setLookOption("ground", value)}
                title={`Ground — ${label}`}
              >
                <span className="sw" style={{ background: hex }} />
                <span className="meta">
                  <span className="nm">{label}</span>
                  <span className="hex">{look.ground === value ? "ground ✓" : "ground"}</span>
                </span>
              </button>
            ))}

            {FIXED.map(([label, hex]) => (
              <div key={label} className="pal-tile locked" title={`${label} — fixed`}>
                <span className="sw" style={{ background: hex }} />
                <span className="meta">
                  <span className="nm">{label}</span>
                  <span className="hex">fixed</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {(accent || signal) && (
              <button
                className="chip dim"
                style={{ cursor: "pointer" }}
                onClick={async () => {
                  await clearAccent();
                  await clearSignal();
                }}
              >
                reset colours to preset
              </button>
            )}
            {accentMsg && <span className="label">{accentMsg}</span>}
          </div>
        </div>

        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--line-dim)" }}>
          <div className="opt-grid">
            {OPTIONS.filter((o) => o.key !== "ground").map((o) => (
              <div key={o.key}>
                <div className="label mb-1">{o.label}</div>
                <p className="label mb-2" style={{ whiteSpace: "normal", opacity: 0.7 }}>
                  {o.hint}
                </p>
                <div className="flex flex-wrap gap-2">
                  {o.choices.map(([value, text]) => (
                    <button
                      key={value}
                      className={look[o.key as keyof typeof look] === value ? "chip" : "chip dim"}
                      style={{ cursor: "pointer", padding: ".35em .8em" }}
                      onClick={() => setLookOption(o.key, value)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
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
              style={field}
            >
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
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
              style={field}
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
              style={field}
            />
            {keyStatus.startsWith("override") && (
              <button className="chip dim" style={{ cursor: "pointer" }} onClick={clearKey}>
                clear override
              </button>
            )}
          </div>
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn" onClick={saveVoice}>
            ▸ Save Voice Settings
          </button>
          {voiceMsg && <span className="label">{voiceMsg}</span>}
        </div>
        <p className="label mt-3" style={{ whiteSpace: "normal", maxWidth: "56ch" }}>
          The key is stored in your local database and used only by this server to
          mint ephemeral session tokens — it is never sent to the browser.
        </p>
      </section>

      <section className="panel mb-6 px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Vision Analysis
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm" style={{ color: "var(--text)" }}>
          <input
            type="checkbox"
            checked={vision}
            onChange={toggleVision}
            style={{ accentColor: "var(--amber)" }}
          />
          Let the indexing pass look at video frames (scene, appearance, energy).
          Runs entirely on the DGX; appears as the Visual Log line on entries.
        </label>
      </section>

      <section className="panel px-5 py-4">
        <div className="label mb-3" style={{ color: "var(--amber)" }}>
          Change Passphrase
        </div>
        <div className="flex flex-col gap-2">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="current passphrase"
            autoComplete="current-password"
            className="mono px-3 py-2 text-sm outline-none"
            style={field}
          />
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="new passphrase (min 8 characters)"
            autoComplete="new-password"
            className="mono px-3 py-2 text-sm outline-none"
            style={field}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePass()}
            placeholder="repeat new passphrase"
            autoComplete="new-password"
            className="mono px-3 py-2 text-sm outline-none"
            style={field}
          />
          <button className="btn mt-1 self-start" onClick={changePass} disabled={busy}>
            {busy ? "Changing…" : "▸ Change Passphrase"}
          </button>
          {passMsg && (
            <p className="text-sm" style={{ color: passMsg.ok ? "var(--amber)" : "var(--crit)" }}>
              {passMsg.text}
            </p>
          )}
        </div>
        <p className="label mt-4" style={{ whiteSpace: "normal", maxWidth: "52ch" }}>
          Stored as a scrypt hash on your own hardware. If you forget it, reset from
          the DGX shell — see README → Security.
        </p>
      </section>

      <div className="mt-6">
        <About />
      </div>
    </div>
  );
}
