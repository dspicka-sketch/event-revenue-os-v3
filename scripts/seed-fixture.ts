// Creates an isolated FIXTURE organization with two performances of the
// synthetic show. Never touches live organizations.
import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { createConnection, createMappedEvent, createOrganization, upsertTarget } from "../src/db/repo.js";
import { createUser, findUserId, setMembership } from "../src/auth/accounts.js";
import { generatePassword } from "../src/auth/password.js";
import { FIXTURE_ACCOUNT_ID, pilotFixture } from "../src/providers/eventbrite/fixtures.js";
import { syncEvent } from "../src/sync/syncEvent.js";

const DEMO_EMAIL = "demo@example.com";
const db = createPool();
try {
  await migrate(db);
  const existing = await db.query("SELECT id FROM organizations WHERE is_fixture AND name = $1", ["[FIXTURE] Demo Venue"]);
  if (existing.rowCount) {
    console.log(`Fixture organization already exists: ${existing.rows[0].id}`);
  } else {
    const org = await createOrganization(db, { name: "[FIXTURE] Demo Venue", isFixture: true });
    // Fixture-only assumption so the proceeds derivation path can be exercised.
    // Live connections start as 'unverified' until fee ownership is documented.
    const conn = await createConnection(db, {
      organizationId: org.id, provider: "eventbrite", providerAccountId: FIXTURE_ACCOUNT_ID, mode: "fixture",
      secretRef: null, proceedsPolicy: "gross_minus_fees_and_tax",
    });
    // Demo account for the fixture organization only.
    let userId = await findUserId(db, DEMO_EMAIL);
    if (!userId) {
      const password = generatePassword();
      userId = await createUser(db, { email: DEMO_EMAIL, password, displayName: "Fixture demo" });
      console.log(`Demo sign-in: ${DEMO_EMAIL} / ${password}  (shown once; reset with: npm run user -- reset-password ${DEMO_EMAIL})`);
    }
    await setMembership(db, org.id, userId, "admin");
    const fixtureTargets = [
      [{ measure: "paidTickets", value: 420, currency: null }, { measure: "grossAfterRefunds", value: 1_800_000, currency: "USD" }],
      [{ measure: "paidTickets", value: 300, currency: null }],
    ] as const;
    for (const [i, ev] of pilotFixture().entries()) {
      const { canonicalEventId } = await createMappedEvent(db, {
        organizationId: org.id, connectionId: conn.id, sourceEventId: ev.event.id,
        name: ev.event.name!.text!, startUtc: ev.event.start!.utc!,
      });
      for (const t of fixtureTargets[i] ?? []) await upsertTarget(db, org.id, canonicalEventId, { ...t }, userId);
      const out = await syncEvent(db, org.id, canonicalEventId);
      console.log(`Fixture event ${ev.event.id}: ${out.ok ? "synced" : `FAILED ${out.kind}: ${out.message}`}`);
    }
    console.log(`Fixture organization created: ${org.id}`);
  }
} finally {
  await db.end();
}
