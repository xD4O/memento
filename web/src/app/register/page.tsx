"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/register")
      .then((r) => r.json())
      .then((d) => setRegistered(!!d.registered));
  }, []);

  const submit = async () => {
    if (busy) return;
    if (passphrase !== confirm) {
      setError("Passphrases don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase, displayName: name }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError((await res.json()).error ?? "Registration failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const field = {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--text-bright)",
  } as const;

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-5">
      <div className="panel w-full max-w-md px-8 py-10">
        <div className="mono mb-1 text-center font-bold" style={{ color: "var(--amber)", letterSpacing: ".3em" }}>
          MEMENTO TERMINAL
        </div>
        {registered === null ? (
          <p className="label mt-6 text-center pulse">Checking terminal status…</p>
        ) : registered ? (
          <>
            <div className="label mb-6 text-center">registration</div>
            <p className="text-center text-sm" style={{ color: "var(--dim)" }}>
              This terminal already has an operator. One operator per terminal
              for now — multi-operator support arrives with the product phase.
            </p>
            <a className="btn mt-6 w-full justify-center" href="/login" style={{ textDecoration: "none" }}>
              ▸ Go to Login
            </a>
          </>
        ) : (
          <>
            <div className="label mb-8 text-center">
              claim this terminal — create the operator account
            </div>
            <div className="flex flex-col gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="operator name (shown on the HUD)"
                className="mono px-4 py-3 text-sm outline-none" style={field} />
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                placeholder="passphrase (min 8 characters)" autoComplete="new-password"
                className="mono px-4 py-3 text-sm outline-none" style={field} />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="repeat passphrase" autoComplete="new-password"
                className="mono px-4 py-3 text-sm outline-none" style={field} />
              <button className="btn mt-2 w-full justify-center" onClick={submit} disabled={busy}>
                {busy ? "Claiming…" : "▸ Claim Terminal"}
              </button>
              {error && (
                <p className="text-center text-sm" style={{ color: "var(--red)" }}>{error}</p>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
