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
    <main className="flex min-h-[80vh] items-center justify-center px-5">
      <div className="panel w-full max-w-md px-8 py-10">
        <div className="mono mb-1 text-center font-bold" style={{ color: "var(--amber)", letterSpacing: ".3em" }}>
          MEMENTO TERMINAL
        </div>
        <div className="label mb-8 text-center">
          identify to access the personal log
        </div>
        <input
          ref={inputRef}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="operator passphrase"
          autoComplete="current-password"
          className="mono w-full px-4 py-3 text-center outline-none"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            color: "var(--text-bright)",
            letterSpacing: ".15em",
          }}
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
