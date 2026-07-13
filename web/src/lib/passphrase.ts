import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, USER_ID } from "@/lib/db";

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(passphrase, salt, 64).toString("hex")}`;
}

export function verifyAgainst(stored: string | null, passphrase: string): boolean {
  const [saltHex, hashHex] = (stored ?? "").split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(passphrase, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Operator hash lives in users.settings; .env AUTH_HASH is the legacy fallback. */
export async function getStoredHash(): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT settings->>'auth_hash' AS h FROM users WHERE id = $1`,
    [USER_ID]
  );
  return rows[0]?.h ?? process.env.AUTH_HASH ?? null;
}

export async function setStoredHash(hash: string): Promise<void> {
  await db.query(
    `UPDATE users SET settings = jsonb_set(settings, '{auth_hash}', to_jsonb($1::text))
     WHERE id = $2`,
    [hash, USER_ID]
  );
}

export async function isRegistered(): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT settings ? 'auth_hash' AS r FROM users WHERE id = $1`,
    [USER_ID]
  );
  return !!rows[0]?.r || !!process.env.AUTH_HASH;
}
