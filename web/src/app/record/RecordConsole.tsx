"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HudOverlay from "@/components/HudOverlay";

type Mode = "detecting" | "requesting" | "live" | "recording" | "review" | "uploading" | "error";
type Capture = "video" | "audio";

const VIDEO_MIMES = [
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const AUDIO_MIMES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

function pickMime(capture: Capture): string {
  if (typeof MediaRecorder === "undefined") return "";
  const list = capture === "video" ? VIDEO_MIMES : AUDIO_MIMES;
  return list.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function fmtTimer(totalS: number) {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function explainGetUserMediaError(e: unknown, capture: Capture): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return capture === "video"
      ? "No camera found on this machine."
      : "No microphone found on this machine.";
  if (name === "NotAllowedError")
    return "Permission denied. Allow camera/microphone for this site in the browser's site settings, then reload.";
  if (name === "NotReadableError")
    return "The capture device is busy — another app may be using it.";
  return `Capture failed: ${e instanceof Error ? e.message : String(e)}`;
}

export default function RecordConsole({
  sol,
  entryNo,
  userName = "USER",
}: {
  sol: number;
  entryNo: number;
  userName?: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("detecting");
  const [capture, setCapture] = useState<Capture>("video");
  const [hasCam, setHasCam] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealDate, setSealDate] = useState("");
  const [clock, setClock] = useState("--:--");

  useEffect(() => {
    const tick = () => setClock(new Date().toTimeString().slice(0, 5));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const teardownStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const openStream = useCallback(
    async (target: Capture) => {
      teardownStream();
      setMessage(null);
      setMode("requesting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          target === "video"
            ? {
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true,
              }
            : { audio: true }
        );
        streamRef.current = stream;
        if (videoRef.current && target === "video")
          videoRef.current.srcObject = stream;
        setCapture(target);
        setMode("live");
      } catch (e) {
        setMessage(explainGetUserMediaError(e, target));
        setMode("error");
      }
    },
    [teardownStream]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext) {
        setMessage(
          "Recording requires a secure context. Open Memento via localhost or " +
            "HTTPS (e.g. tailscale serve) — camera and mic are blocked on plain " +
            "HTTP addresses."
        );
        setMode("error");
        return;
      }
      if (!navigator.mediaDevices?.enumerateDevices) {
        setMessage("This browser does not support media capture.");
        setMode("error");
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      const cam = devices.some((d) => d.kind === "videoinput");
      const mic = devices.some((d) => d.kind === "audioinput");
      setHasCam(cam);
      setHasMic(mic);
      if (!cam && !mic) {
        setMessage(
          "No camera or microphone on this machine. Recording happens in your " +
            "browser — the DGX only stores and transcribes. Open Memento on a " +
            "device with a camera or mic (laptop, phone) via the HTTPS URL."
        );
        setMode("error");
        return;
      }
      await openStream(cam ? "video" : "audio");
    })();
    return () => {
      cancelled = true;
      stopTimer();
      teardownStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, [reviewUrl]);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = pickMime(capture);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const b = new Blob(chunksRef.current, { type: rec.mimeType });
      setBlob(b);
      setReviewUrl(URL.createObjectURL(b));
      setMode("review");
    };
    rec.start(1000);
    recorderRef.current = rec;
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    setMode("recording");
  };

  const stopRecording = () => {
    stopTimer();
    recorderRef.current?.stop();
  };

  const discard = () => {
    setBlob(null);
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(null);
    setSeconds(0);
    if (videoRef.current && capture === "video")
      videoRef.current.srcObject = streamRef.current;
    setMode("live");
  };

  const commit = async (deliverOn?: string) => {
    if (!blob) return;
    setMode("uploading");
    try {
      const created = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: capture === "video" ? "video_log" : "audio_log",
          mime: blob.type,
          deliverOn: deliverOn ?? null,
        }),
      });
      if (!created.ok) throw new Error(`create failed: ${created.status}`);
      const { id } = await created.json();

      const put = await fetch(`/api/entries/${id}/media`, {
        method: "PUT",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`);

      teardownStream();
      router.push(deliverOn ? "/" : `/entry/${id}`);
    } catch (e) {
      setMessage(
        `Upload failed: ${e instanceof Error ? e.message : e}. ` +
          "The recording is still here — try committing again."
      );
      setMode("review");
    }
  };

  const importFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/") && !f.type.startsWith("audio/")) {
      setMessage(`"${f.name}" is not a video or audio file.`);
      return;
    }
    stopTimer();
    teardownStream();
    setMessage(null);
    setCapture(f.type.startsWith("audio/") ? "audio" : "video");
    setBlob(f);
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(URL.createObjectURL(f));
    setSeconds(0);
    setMode("review");
  };

  const busy = mode === "recording" || mode === "uploading";

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24 pt-8">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="label" style={{ color: "var(--amber)" }}>
          Record Console
        </span>
        <span className="label">
          SOL {String(sol).padStart(3, "0")} · Entry {String(entryNo).padStart(3, "0")}
        </span>
        {hasCam && hasMic && !busy && mode !== "review" && (
          <button
            className="chip cyan"
            style={{ cursor: "pointer", background: "none" }}
            onClick={() => openStream(capture === "video" ? "audio" : "video")}
          >
            mode: {capture} ⇄
          </button>
        )}
        {!hasCam && hasMic && <span className="chip cyan">audio only</span>}
        <span
          className="ml-auto mono text-sm"
          style={{ color: mode === "recording" ? "var(--red)" : "var(--dim)" }}
        >
          {mode === "recording" && <span className="rec-dot mr-2 inline-block" />}
          {fmtTimer(seconds)}
        </span>
      </div>

      <div className="panel relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
        {mode === "review" ? (
          reviewUrl &&
          (capture === "video" ? (
            <video src={reviewUrl} controls playsInline className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-6">
              <span className="mono" style={{ color: "var(--cyan)", letterSpacing: ".2em" }}>
                AUDIO LOG — REVIEW
              </span>
              <audio src={reviewUrl} controls className="w-2/3" />
            </div>
          ))
        ) : capture === "video" ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <span
              className={`mono text-4xl ${mode === "recording" ? "pulse" : ""}`}
              style={{ color: mode === "recording" ? "var(--red)" : "var(--dim)" }}
            >
              ◉
            </span>
            <span className="label" style={{ letterSpacing: ".24em" }}>
              Audio Log {mode === "recording" ? "— recording" : "— standing by"}
            </span>
          </div>
        )}

        {capture === "video" && mode !== "detecting" && mode !== "error" && (
          <HudOverlay sol={sol} entryNo={entryNo} time={clock} userName={userName} />
        )}
        {mode === "recording" && (
          <div
            className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 px-2 py-1"
            style={{ background: "rgba(7,9,13,.7)" }}
          >
            <span className="rec-dot" />
            <span className="mono text-xs" style={{ color: "var(--red)", letterSpacing: ".2em" }}>
              REC
            </span>
          </div>
        )}
        {mode === "review" && (
          <div
            className="pointer-events-none absolute left-3 top-3 px-2 py-1 label"
            style={{ background: "rgba(7,9,13,.7)", color: "var(--cyan)" }}
          >
            Review — not yet committed
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {mode === "live" && (
          <button className="btn" onClick={startRecording}>
            ● Start Recording
          </button>
        )}
        {mode === "recording" && (
          <button className="btn danger" onClick={stopRecording}>
            ■ Stop
          </button>
        )}
        {mode === "review" && (
          <>
            <button className="btn" onClick={() => commit()}>
              ▲ Commit Entry
            </button>
            {!sealOpen ? (
              <button className="chip cyan" style={{ cursor: "pointer", background: "none", padding: ".45em 1em" }}
                onClick={() => setSealOpen(true)} title="Hide this entry until a future date — a message to future you">
                ◍ Seal as Time Capsule…
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <input
                  type="date"
                  value={sealDate}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  onChange={(e) => setSealDate(e.target.value)}
                  className="mono px-2 py-1.5 text-sm outline-none"
                  style={{ background: "var(--panel)", border: "1px solid rgba(89,210,222,.35)", color: "var(--cyan)", colorScheme: "dark" }}
                />
                <button className="chip cyan" style={{ cursor: "pointer", background: "none", padding: ".45em 1em" }}
                  disabled={!sealDate} onClick={() => sealDate && commit(sealDate)}>
                  ◍ Seal until {sealDate || "…"}
                </button>
              </span>
            )}
            <button className="btn danger" onClick={discard}>
              ✕ Discard
            </button>
          </>
        )}
        {mode === "uploading" && (
          <span className="label pulse" style={{ color: "var(--amber)" }}>
            Transmitting entry…
          </span>
        )}
        {mode === "detecting" && <span className="label">Scanning for capture devices…</span>}
        {mode === "requesting" && (
          <span className="label">
            Requesting {capture === "video" ? "camera + mic" : "microphone"}… if nothing
            happens, look for the browser's permission prompt.
          </span>
        )}
        {mode === "error" && (
          <button className="btn" onClick={() => openStream(hasCam ? "video" : "audio")}>
            ↻ Retry
          </button>
        )}
        {!busy && mode !== "review" && (
          <>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              ▲ Import Media File
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(e) => {
                importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {message && (
        <p className="mt-4 max-w-prose text-sm" style={{ color: "var(--red)" }}>
          {message}
        </p>
      )}
    </main>
  );
}
