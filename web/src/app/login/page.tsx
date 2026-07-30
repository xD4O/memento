"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.get("lock")) fetch("/api/auth/logout", { method: "POST" });
    inputRef.current?.focus();
  }, [params]);

  const submit = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError((await res.json()).error ?? "Access denied.");
        setPassphrase("");
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="lock-wrap stage-pad">
      <div className="panel lock-card">
        <div className="lock-ring" aria-hidden="true" />
        <div className="wordmark" style={{ display: "block", marginBottom: 8 }}>
          MEMENT<span className="dot">O</span>
        </div>
        <p className="label" style={{ marginBottom: 22 }}>
          Personal log · operator access required
        </p>
        <input
          ref={inputRef}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="operator passphrase"
          autoComplete="current-password"
          className="field"
          style={{ textAlign: "center", letterSpacing: ".3em" }}
        />
        <button className="btn mt-4 w-full justify-center" onClick={submit} disabled={busy}>
          {busy ? "Verifying…" : "▸ Identify"}
        </button>
        {error && (
          <p className="mt-4 text-center text-sm" style={{ color: "var(--red)" }}>
            {error}
          </p>
        )}
        <p className="label mt-6 text-center">
          new terminal? <a href="/register">claim it</a> · change passphrase in
          Settings once identified
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginConsole />
    </Suspense>
  );
}
