"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const AvatarLive = dynamic(() => import("@/components/AvatarLive"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="label pulse">Materializing avatar…</span>
    </div>
  ),
});

type Mode = "idle" | "connecting" | "live" | "ending" | "nokey" | "error";
type Turn = { speaker: "user" | "agent"; text: string; t: number };
type RecMode = "video" | "audio" | "off";
type Presence = "waveform" | "ring" | "avatar";
type SessionMode = "converse" | "listen";

// Presence surfaces, cycled in this order:
//   waveform — layered contours that deform per-angle on speech
//   ring     — concentric rings that swell with level
//   avatar   — AvatarForcing delayed-replay preview (renders each reply on the
//              DGX at ~5x realtime — a taste test, not lip-sync)
const AVATAR_ENABLED = true;
const PRESENCE_ORDER: Presence[] = ["waveform", "ring", "avatar"];

function fmtTimer(totalS: number) {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function LiveConsole({ sol }: { sol: number }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const startRef = useRef<number>(0);
  const turnsRef = useRef<Turn[]>([]);
  const levelsRef = useRef({ agent: 0, user: 0 });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const camRef = useRef<MediaStream | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pipRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [recMode, setRecMode] = useState<RecMode>("video");
  const [presence, setPresence] = useState<Presence>("waveform");
  const [sessionMode, setSessionMode] = useState<SessionMode>("converse");
  const sessionModeRef = useRef<SessionMode>("converse");
  const [seconds, setSeconds] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [cost, setCost] = useState(0);
  const [avatarClip, setAvatarClip] = useState<string | null>(null);
  const [avatarPending, setAvatarPending] = useState(0);
  const agentRecRef = useRef<MediaRecorder | null>(null);
  const agentChunksRef = useRef<Blob[]>([]);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const presenceRef = useRef<Presence>("waveform");
  const costRef = useRef(0);
  const ratesRef = useRef({ audioIn: 32, audioOut: 64, textIn: 4, textOut: 16 });

  useEffect(() => {
    const stored = localStorage.getItem("memento_presence");
    if (stored && (PRESENCE_ORDER as string[]).includes(stored)) {
      const p = stored as Presence;
      if (p === "avatar" && !AVATAR_ENABLED) return;
      setPresence(p);
      presenceRef.current = p;
    }
  }, []);

  const togglePresence = () => {
    const cycle = AVATAR_ENABLED
      ? PRESENCE_ORDER
      : PRESENCE_ORDER.filter((p) => p !== "avatar");
    const next = cycle[(cycle.indexOf(presence) + 1) % cycle.length];
    setPresence(next);
    presenceRef.current = next;
    localStorage.setItem("memento_presence", next);
  };

  // keep the transcript pinned to the latest turn
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const pushTurn = (speaker: Turn["speaker"], text: string) => {
    if (!text.trim()) return;
    const t = Math.max(0, (Date.now() - startRef.current) / 1000);
    const turn = { speaker, text: text.trim(), t };
    turnsRef.current.push(turn);
    setTurns([...turnsRef.current]);
  };

  const attachAnalyser = (
    ctx: AudioContext,
    stream: MediaStream,
    key: "agent" | "user"
  ) => {
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const sample = () => {
      an.getByteFrequencyData(buf);
      levelsRef.current[key] =
        buf.reduce((a, b) => a + b, 0) / buf.length / 255;
      requestAnimationFrame(sample);
    };
    sample();
  };

  // Presence surfaces, both driven by the live analyser levels. The speaker
  // sets the hue — signal amber when the agent talks, ice when you do.
  //   waveform: three contours deforming per-angle on a slow sum of sines
  //   ring:     concentric rings that swell with level
  useEffect(() => {
    if (presence !== "waveform" && presence !== "ring") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    // semantic hues, literal hex and never theme-swapped
    const SIGNAL = css.getPropertyValue("--signal").trim() || "#ff9d3d";
    const ICE = css.getPropertyValue("--ice").trim() || "#7fd4e8";
    const rgba = (hex: string, a: number) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    let raf = 0;
    let phase = 0;
    let smooth = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const pw = Math.round(rect.width * dpr);
        const ph = Math.round(rect.height * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = rect.width;
        const h = rect.height;
        const cx = w / 2;
        const cy = h / 2;
        const base = Math.min(w, h) * 0.17;

        const { agent, user } = levelsRef.current;
        const agentLed = agent >= user;
        const lead = agentLed ? SIGNAL : ICE;
        const outer = agentLed ? ICE : SIGNAL;

        // Smooth the analyser so the surface glides with speech instead of
        // strobing on every frame. Attack fast, release slow.
        const target = Math.min(1, Math.max(agent, user));
        const k = target > smooth ? 0.35 : 0.08;
        smooth += (target - smooth) * k;
        const level = smooth;

        ctx2d.clearRect(0, 0, w, h);

        // graticule, shared by both surfaces
        ctx2d.strokeStyle = rgba(ICE, 0.07);
        ctx2d.lineWidth = 1;
        for (let g = 1; g <= 4; g++) {
          ctx2d.beginPath();
          ctx2d.arc(cx, cy, base * (0.6 + g * 0.62), 0, Math.PI * 2);
          ctx2d.stroke();
        }
        ctx2d.beginPath();
        ctx2d.moveTo(cx - w, cy);
        ctx2d.lineTo(cx + w, cy);
        ctx2d.moveTo(cx, cy - h);
        ctx2d.lineTo(cx, cy + h);
        ctx2d.stroke();

        if (presence === "waveform") {
          // Deforming contours. Swell is capped so the outer contour stays
          // inside the panel at full volume and the inner one never collapses
          // into the core glow.
          const pts = 180;
          const swell = 1 + level * 2.2;
          for (let layer = 0; layer < 3; layer++) {
            ctx2d.beginPath();
            for (let i = 0; i <= pts; i++) {
              const a = (i / pts) * Math.PI * 2;
              const amp =
                (Math.sin(a * 3 + phase * 1.7 + layer) * 0.038 +
                  Math.sin(a * 7 - phase * 2.3 + layer * 2) * 0.021 +
                  Math.sin(a * 11 + phase * 1.1) * 0.012) *
                swell;
              const r = base * (1 + layer * 0.34) * (1 + amp * (1 + layer * 0.5));
              const x = cx + Math.cos(a) * r;
              const y = cy + Math.sin(a) * r;
              if (i === 0) ctx2d.moveTo(x, y);
              else ctx2d.lineTo(x, y);
            }
            ctx2d.closePath();
            ctx2d.strokeStyle =
              layer === 0 ? rgba(lead, 0.85) : rgba(outer, 0.36 - layer * 0.11);
            ctx2d.lineWidth = layer === 0 ? 1.6 : 1;
            ctx2d.stroke();
          }
        } else {
          // Concentric rings — the original surface, now smoothed and DPR-aware.
          const gap = base * 0.34;
          for (let r0 = 0; r0 < 3; r0++) {
            const wobble =
              (reduce ? 0 : Math.sin(phase * 1.6 + r0 * 2.1) * base * 0.03) +
              level * base * 0.62 * (1 - r0 * 0.25);
            ctx2d.beginPath();
            ctx2d.arc(cx, cy, base + r0 * gap + wobble, 0, Math.PI * 2);
            ctx2d.strokeStyle =
              r0 === 0 ? rgba(lead, 0.85) : rgba(outer, 0.4 - r0 * 0.12);
            ctx2d.lineWidth = r0 === 0 ? 2 : 1;
            ctx2d.stroke();
          }
        }

        // core — breathes idle, blooms on speech
        const pulse = (reduce ? 1 : 1 + Math.sin(phase * 1.1) * 0.16) + level * 0.5;
        const cr = base * 0.5 * pulse;
        const core = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, cr);
        core.addColorStop(0, rgba(agentLed ? "#ffc478" : "#c8f0fa", 0.9));
        core.addColorStop(1, rgba(lead, 0));
        ctx2d.fillStyle = core;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx2d.fill();
      }

      // waveform drifts at roughly half the old rate; the ring keeps its own
      if (!reduce) phase += presence === "waveform" ? 0.0045 : 0.009;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [presence]);

  const stopRecorder = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () =>
        resolve(new Blob(recChunksRef.current, { type: rec.mimeType }));
      rec.stop();
    });

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    camRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
    camRef.current = null;
    recorderRef.current = null;
    audioCtxRef.current = null;
    mixDestRef.current = null;
  };

  useEffect(() => cleanup, []);

  const begin = async () => {
    setMessage(null);
    setMode("connecting");
    try {
      sessionModeRef.current = sessionMode;
      const minted = await fetch("/api/agent/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: sessionMode }),
      });
      if (minted.status === 501) {
        setMode("nokey");
        setMessage((await minted.json()).message);
        return;
      }
      if (!minted.ok)
        throw new Error(`session mint failed: ${(await minted.json()).detail ?? minted.status}`);
      const { clientSecret, model, sdpBase, rates } = await minted.json();
      if (rates) ratesRef.current = rates;

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      // debug handle for diagnostics (harmless in production)
      (window as unknown as { __memento_pc?: RTCPeerConnection }).__memento_pc = pc;
      pc.addTrack(mic.getTracks()[0], mic);
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      attachAnalyser(audioCtx, mic, "user");

      // Session recording: mix mic + agent audio into one track, plus camera.
      let recStream: MediaStream | null = null;
      if (recMode !== "off") {
        const dest = audioCtx.createMediaStreamDestination();
        mixDestRef.current = dest;
        audioCtx.createMediaStreamSource(mic).connect(dest);
        const tracks: MediaStreamTrack[] = [...dest.stream.getAudioTracks()];
        if (recMode === "video") {
          try {
            const cam = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            });
            camRef.current = cam;
            if (pipRef.current) pipRef.current.srcObject = cam;
            tracks.unshift(cam.getVideoTracks()[0]);
          } catch {
            // no camera — degrade to audio-only recording
          }
        }
        recStream = new MediaStream(tracks);
      }

      pc.ontrack = (ev) => {
        if (audioRef.current) audioRef.current.srcObject = ev.streams[0];
        remoteStreamRef.current = ev.streams[0];
        attachAnalyser(audioCtx, ev.streams[0], "agent");
        if (mixDestRef.current)
          audioCtx
            .createMediaStreamSource(ev.streams[0])
            .connect(mixDestRef.current);
      };

      const startAgentClip = () => {
        if (presenceRef.current !== "avatar" || !remoteStreamRef.current) return;
        if (agentRecRef.current?.state === "recording") return;
        try {
          const rec = new MediaRecorder(remoteStreamRef.current);
          agentChunksRef.current = [];
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) agentChunksRef.current.push(e.data);
          };
          rec.start(250);
          agentRecRef.current = rec;
        } catch {
          /* capture unsupported — avatar stays on the still */
        }
      };
      const finishAgentClip = () => {
        const rec = agentRecRef.current;
        if (!rec || rec.state !== "recording") return;
        rec.onstop = async () => {
          const blob = new Blob(agentChunksRef.current, { type: rec.mimeType });
          if (blob.size < 4000 || presenceRef.current !== "avatar") return;
          setAvatarPending((n) => n + 1);
          try {
            const res = await fetch("/api/avatar/render", {
              method: "POST",
              headers: { "Content-Type": blob.type },
              body: blob,
            });
            if (res.ok && res.status === 200) {
              const clip = await res.blob();
              setAvatarClip((old) => {
                if (old) URL.revokeObjectURL(old);
                return URL.createObjectURL(clip);
              });
            }
          } catch {
            /* renderer busy or down — still image remains */
          } finally {
            setAvatarPending((n) => Math.max(0, n - 1));
          }
        };
        rec.stop();
        agentRecRef.current = null;
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = async (ev) => {
        const e = JSON.parse(ev.data);
        console.debug("[realtime]", e.type);
        if (e.type === "output_audio_buffer.started") startAgentClip();
        if (
          e.type === "output_audio_buffer.stopped" ||
          e.type === "output_audio_buffer.cleared" ||
          e.type === "response.output_audio.done" ||
          e.type === "response.audio.done"
        )
          finishAgentClip();
        if (e.type === "conversation.item.input_audio_transcription.completed") {
          pushTurn("user", e.transcript ?? "");
          // listen mode wake word: only speak when addressed by name
          if (
            sessionModeRef.current === "listen" &&
            /\bmemento\b/i.test(e.transcript ?? "")
          )
            dc.send(JSON.stringify({ type: "response.create" }));
        }
        // agent transcript event name differs between beta and GA APIs
        if (
          e.type === "response.audio_transcript.done" ||
          e.type === "response.output_audio_transcript.done"
        )
          pushTurn("agent", e.transcript ?? "");
        if (e.type === "response.done" && e.response?.usage) {
          const u = e.response.usage;
          const r = ratesRef.current;
          const inDet = u.input_token_details ?? {};
          const outDet = u.output_token_details ?? {};
          const delta =
            ((inDet.audio_tokens ?? 0) * r.audioIn +
              ((inDet.text_tokens ?? 0) + (inDet.cached_tokens ?? 0) * 0) *
                r.textIn +
              (outDet.audio_tokens ?? 0) * r.audioOut +
              (outDet.text_tokens ?? 0) * r.textOut) /
            1_000_000;
          costRef.current += delta;
          setCost(costRef.current);
        }
        if (e.type === "response.function_call_arguments.done") {
          let output: unknown;
          try {
            const args = JSON.parse(e.arguments ?? "{}");
            if (e.name === "create_pin") {
              const res = await fetch("/api/pins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: args.text ?? "",
                  due: args.due ?? null,
                  source: "agent",
                }),
              });
              const pin = await res.json();
              output = res.ok
                ? { pinned: true, kind: pin.kind, due: pin.due ?? null }
                : { error: "pin failed" };
            } else {
              const res = await fetch("/api/agent/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: args.query ?? "" }),
              });
              output = (await res.json()).results ?? [];
            }
          } catch {
            output = { error: "tool unavailable" };
          }
          dc.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: e.call_id,
                output: JSON.stringify(output),
              },
            })
          );
          dc.send(JSON.stringify({ type: "response.create" }));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(
        `${sdpBase ?? "https://api.openai.com/v1/realtime/calls"}?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );
      if (!sdpRes.ok) throw new Error(`WebRTC handshake failed: ${sdpRes.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

      startRef.current = Date.now();
      costRef.current = 0;
      setCost(0);
      if (recStream) {
        const hasVideo = recStream.getVideoTracks().length > 0;
        const mimeCandidates = hasVideo
          ? ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]
          : ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
        const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(
          recStream,
          mime ? { mimeType: mime } : undefined
        );
        recChunksRef.current = [];
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) recChunksRef.current.push(ev.data);
        };
        rec.start(1000);
        recorderRef.current = rec;
      }
      turnsRef.current = [];
      setTurns([]);
      setSeconds(0);
      timerRef.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)),
        1000
      );
      setMode("live");
    } catch (e) {
      cleanup();
      setMessage(e instanceof Error ? e.message : String(e));
      setMode("error");
    }
  };

  const end = async () => {
    setMode("ending");
    const recording = await stopRecorder();
    cleanup();
    const turnsToSave = turnsRef.current;
    if (turnsToSave.length === 0) {
      setMode("idle");
      setMessage("Session ended — nothing was said, so no entry was logged.");
      return;
    }
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startedAt: new Date(startRef.current).toISOString(),
          turns: turnsToSave,
          hasMedia: !!recording && recording.size > 0,
          costUsd: Number(costRef.current.toFixed(4)),
        }),
      });
      const { id } = await res.json();
      if (recording && recording.size > 0) {
        const put = await fetch(`/api/entries/${id}/media`, {
          method: "PUT",
          headers: { "Content-Type": recording.type },
          body: recording,
        });
        // recording upload failed → index the transcript anyway
        if (!put.ok) await fetch(`/api/entries/${id}/enqueue`, { method: "POST" });
      }
      router.push(`/entry/${id}`);
    } catch (e) {
      setMessage(`Failed to save session: ${e instanceof Error ? e.message : e}`);
      setMode("error");
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-5 pb-24 pt-8">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="label" style={{ color: "var(--amber)" }}>
          Live Session
        </span>
        <span className="label">SOL {String(sol).padStart(3, "0")}</span>
        {mode === "idle" && (
          <>
            <button
              className="chip cyan"
              style={{ cursor: "pointer", background: "none" }}
              onClick={() =>
                setRecMode(
                  recMode === "video" ? "audio" : recMode === "audio" ? "off" : "video"
                )
              }
              title="Cycle session recording mode"
            >
              rec: {recMode} ⇄
            </button>
            <button
              className="chip"
              style={{ cursor: "pointer", background: "none" }}
              onClick={() =>
                setSessionMode(sessionMode === "converse" ? "listen" : "converse")
              }
              title="Listen mode: Memento stays silent and transcribes; say its name to get a response"
            >
              mode: {sessionMode} ⇄
            </button>
          </>
        )}
        {mode === "live" && sessionModeRef.current === "listen" && (
          <span className="chip cyan">◉ listen mode — say “Memento” to talk</span>
        )}
        {AVATAR_ENABLED && (
          <button
            className="chip"
            style={{ cursor: "pointer", background: "none" }}
            onClick={togglePresence}
            title="Switch the agent's visual presence"
          >
            presence: {presence} ⇄
          </button>
        )}
        {mode === "live" && recMode !== "off" && (
          <span className="chip dim">recording {recMode}</span>
        )}
        {mode === "live" && (
          <span className="chip red">
            <span className="rec-dot mr-2 inline-block" />
            LIVE
          </span>
        )}
        <span className="ml-auto flex items-center gap-4">
          {(mode === "live" || cost > 0) && (
            <span className="mono text-xs" style={{ color: "var(--dim)" }} title="estimated API cost this session">
              ≈${cost.toFixed(2)}
            </span>
          )}
          <span className="mono text-sm" style={{ color: "var(--dim)" }}>
            {fmtTimer(seconds)}
          </span>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div
          className="panel relative flex flex-col items-center justify-center"
          style={{ aspectRatio: "16/10" }}
        >
          {presence === "avatar" ? (
            <div className="absolute inset-0">
              <AvatarLive clipUrl={avatarClip} pendingCount={avatarPending} />
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={640}
              height={400}
              className="absolute inset-0 h-full w-full"
            />
          )}
          <audio ref={audioRef} autoPlay className="hidden" />
          <video
            ref={pipRef}
            autoPlay
            muted
            playsInline
            className="absolute bottom-3 right-3 w-1/4"
            style={{
              transform: "scaleX(-1)",
              border: "1px solid var(--line-dim)",
              display: camRef.current && mode === "live" ? "block" : "none",
            }}
          />
          <div className="absolute bottom-4 flex items-center gap-3">
            {mode === "idle" && (
              <button className="btn" onClick={begin}>
                ◉ Begin Session
              </button>
            )}
            {mode === "connecting" && (
              <span className="label pulse">Opening the channel…</span>
            )}
            {mode === "live" && (
              <button className="btn danger" onClick={end}>
                ■ End &amp; Log Session
              </button>
            )}
            {mode === "ending" && (
              <span className="label pulse">Committing session to the log…</span>
            )}
            {(mode === "error" || mode === "nokey") && (
              <button className="btn" onClick={begin}>
                ↻ Retry
              </button>
            )}
          </div>
        </div>

        <div className="panel flex max-h-[60vh] min-h-64 flex-col">
          <div
            className="label px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--line-dim)", color: "var(--amber)" }}
          >
            Session Transcript
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <p className="label">
                {mode === "live"
                  ? "Say hello — Memento is listening."
                  : "The conversation will appear here."}
              </p>
            )}
            {turns.map((t, i) => (
              <p key={i} className="mb-2 text-sm">
                <span className="mono mr-2 text-xs" style={{ color: "var(--dim)" }}>
                  {fmtTimer(Math.floor(t.t))}
                </span>
                <span
                  className="mono mr-2 text-xs"
                  style={{
                    color: t.speaker === "agent" ? "var(--amber)" : "var(--cyan)",
                    letterSpacing: ".12em",
                  }}
                >
                  {t.speaker === "agent" ? "MEMENTO" : "YOU"}
                </span>
                <span style={{ color: "var(--text)" }}>{t.text}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      {message && (
        <p
          className="mt-4 max-w-prose text-sm"
          style={{ color: mode === "nokey" ? "var(--amber)" : "var(--red)" }}
        >
          {message}
        </p>
      )}
    </main>
  );
}
