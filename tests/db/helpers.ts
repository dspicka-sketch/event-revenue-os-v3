import { execFileSync } from "node:child_process";
import { Pool, type PoolClient } from "pg";

export const DB = process.env.TEST_DB ?? "p104test";

export function resetDb() {
  execFileSync("bash", ["scripts/db-reset-local.sh", DB], { stdio: "pipe" });
}

export function pool() {
  return new Pool({
    host: process.env.PGHOST ?? "localhost",
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database: DB,
    max: 8,
  });
}

/** Run `fn` as a Supabase `authenticated` user (or anon when uid is null), inside a rolled-back transaction. */
export async function as<T>(p: Pool, uid: string | null, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    const r = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
}
