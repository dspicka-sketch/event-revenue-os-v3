// Adds the handoff's historical artists to one organization's watchlist:
//   npm run watchlist:seed -- <organizationId>
// Safe to re-run: acts already on the watchlist are left as they are.
import { readFile } from "node:fs/promises";
import { createPool } from "../src/db/pool.js";
import { addWatchArtists, getOrganization } from "../src/db/repo.js";

const orgId = process.argv[2];
if (!orgId) {
  console.error("Usage: npm run watchlist:seed -- <organizationId>");
  process.exit(1);
}
const seed = JSON.parse(await readFile(new URL("./data/watchlist-handoff-v6.1.json", import.meta.url), "utf8")) as { sourceNote: string; artists: { name: string; genre: string }[] };
const db = createPool();
try {
  const org = await getOrganization(db, orgId);
  if (!org) throw new Error(`No organization ${orgId}.`);
  const added = await addWatchArtists(db, org.id, seed.artists, seed.sourceNote);
  console.log(`${org.name}: ${added} of ${seed.artists.length} artists added to the watchlist (the rest were already there).`);
} finally {
  await db.end();
}
