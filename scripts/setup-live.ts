// Registers the live pilot organization, Eventbrite connection and one event
// mapping from server environment variables. Stores only the NAME of the
// secret variable. Read-only: makes no Eventbrite writes.
import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { createConnection, createMappedEvent, createOrganization } from "../src/db/repo.js";

const orgName = process.argv[2] ?? "Pilot Venue";
const accountId = process.env.EVENTBRITE_ORGANIZATION_ID;
const eventId = process.env.EVENTBRITE_EVENT_ID;
if (!accountId || !eventId) {
  console.error("Set EVENTBRITE_ORGANIZATION_ID and EVENTBRITE_EVENT_ID in .env first (see README → Live setup).");
  process.exit(1);
}
if (!process.env.EVENTBRITE_TOKEN) console.warn("Warning: EVENTBRITE_TOKEN is not set; the first Refresh will report 'not configured'.");

const db = createPool();
try {
  await migrate(db);
  let orgId: string;
  const existing = await db.query<{ id: string }>("SELECT id FROM organizations WHERE NOT is_fixture AND name = $1", [orgName]);
  if (existing.rows[0]) orgId = existing.rows[0].id;
  else orgId = (await createOrganization(db, { name: orgName, isFixture: false })).id;

  let conn = (await db.query<{ id: string }>(
    "SELECT id FROM source_connections WHERE organization_id = $1 AND provider = 'eventbrite' AND provider_account_id = $2", [orgId, accountId])).rows[0];
  if (!conn) conn = await createConnection(db, { organizationId: orgId, provider: "eventbrite", providerAccountId: accountId, mode: "live", secretRef: "EVENTBRITE_TOKEN" });

  const mapped = await db.query<{ canonical_event_id: string }>(
    "SELECT canonical_event_id FROM source_event_mappings WHERE organization_id = $1 AND provider = 'eventbrite' AND provider_account_id = $2 AND source_event_id = $3",
    [orgId, accountId, eventId]);
  const canonicalEventId = mapped.rows[0]?.canonical_event_id ??
    (await createMappedEvent(db, { organizationId: orgId, connectionId: conn.id, sourceEventId: eventId, name: `Eventbrite event ${eventId}` })).canonicalEventId;
  console.log(`Grant access with: npm run user -- create you@yourdomain  then  npm run user -- grant you@yourdomain ${orgId} admin`);
  console.log(`Organization ${orgId}\nConnection ${conn.id}\nCanonical event ${canonicalEventId}\nNext: npm run sync -- ${orgId} ${canonicalEventId}  (or use Refresh in the UI)`);
} finally {
  await db.end();
}
