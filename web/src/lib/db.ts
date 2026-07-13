import { Pool } from "pg";

const g = globalThis as unknown as { __mementoPool?: Pool };

export const db =
  g.__mementoPool ??
  (g.__mementoPool = new Pool({ connectionString: process.env.DATABASE_URL }));

export const USER_ID =
  process.env.MEMENTO_USER_ID ?? "00000000-0000-0000-0000-000000000001";
