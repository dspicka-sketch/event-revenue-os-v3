import { createPool, type Db } from "../../src/db/pool.js";
import { migrate } from "../../src/db/migrate.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;

/** DB-backed tests are skipped (not faked) when TEST_DATABASE_URL is absent. */
export const describeDb = TEST_DB_URL ? (await import("vitest")).describe : (await import("vitest")).describe.skip;

export async function freshDb(): Promise<Db> {
  const db = createPool(TEST_DB_URL);
  await migrate(db);
  await db.query("TRUNCATE organizations, users CASCADE");
  return db;
}
