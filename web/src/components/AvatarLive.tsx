"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live avatar surface (delayed-replay): shows the narrator still; when a
 * rendered clip of the agent's latest reply arrives, plays it muted (the
 * real audio already played live). GB10 renders at ~5x realtime, so clips
 * trail speech by ~15-20s — this surface is a taste test, not lip-sync.
 */
export default function AvatarLive({
  clipUrl,
  pendingCount,
}: {
  clipUrl: string | null;
  pendingCount: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (clipUrl && videoRef.current) {
      videoRef.current.src = clipUrl;
      videoRef.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [clipUrl]);

  return (
    <div className="relative h-full w-full" style={{ background: "#07090D" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/api/avatar/ref"
        alt=""
        className="absolute inset-0 h-full w-full object-contain"
        style={{ opacity: playing ? 0 : 0.9, transition: "opacity .4s" }}
      />
      <video
        ref={videoRef}
        muted
        playsInline
        onEnded={() => setPlaying(false)}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ opacity: playing ? 1 : 0, transition: "opacity .4s" }}
      />
      {pendingCount > 0 && (
        <div
          className="mono absolute left-3 top-3 flex items-center gap-2 px-2 py-1 text-xs"
          style={{ background: "rgba(7,9,13,.75)", color: "var(--amber)", letterSpacing: ".14em" }}
        >
          <span className="rec-dot" style={{ background: "var(--amber)" }} />
          RENDERING {pendingCount > 1 ? `×${pendingCount}` : ""} — clips trail speech ~15s
        </div>
      )}
    </div>
  );
}
