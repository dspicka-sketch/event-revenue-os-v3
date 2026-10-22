import pg from "pg";

// bigint (int8) columns hold money in minor units. Parse to number, refusing
// anything outside the safe-integer range rather than losing precision.
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${v} exceeds safe integer range`);
  return n;
});

export type Db = pg.Pool;

export function createPool(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  return new pg.Pool({ connectionString: url, max: 10 });
}
