// Session token: base64url(expiryMs).base64url(HMAC-SHA256(expiryMs, secret))
// Web Crypto only — must run in the proxy (edge-safe) and in Node routes.

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export const SESSION_COOKIE = "memento_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export async function signSession(secret: string): Promise<string> {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const payload = b64url(enc.encode(exp));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  const expected = await hmac(payload, secret);
  if (mac.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++)
    diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const exp = Number(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return Number.isFinite(exp) && exp > Date.now();
  } catch {
    return false;
  }
}
