import { describe, expect, it } from "vitest";
import { EventbriteClient } from "../src/providers/eventbrite/client.js";
import { createFixtureTransport, FIXTURE_ACCOUNT_ID, pilotFixture } from "../src/providers/eventbrite/fixtures.js";
import { probeEventbrite, probeToMarkdown } from "../src/providers/eventbrite/probe.js";

function client(events = pilotFixture(1), attendeeDefault: "all" | "attending" = "all") {
  const t = createFixtureTransport({ events, pageSize: 25, attendeeDefault });
  return new EventbriteClient({ token: "t", fetchImpl: t.fetch, sleep: async () => {} });
}

describe("Eventbrite live probe", () => {
  it("summarizes statuses, money fields, pagination and refund shape", async () => {
    const r = await probeEventbrite(client(), { organizationId: FIXTURE_ACCOUNT_ID, eventId: "fx-1001" });
    expect(r.authenticated).toBe(true);
    expect(r.event.organizationMatchesConfig).toBe(true);
    expect(r.orders.total).toBe(141);
    expect(r.orders.statusValues).toMatchObject({ placed: expect.any(Number), refunded: 1, unpaid: expect.any(Number) });
    expect(r.orders.costs.gross).toEqual({ present: 141, nullOrMissing: 0, nonIntegerValue: 0 });
    expect(r.orders.feeShape.grossEqualsBasePlusFeesPlusTax).toBeGreaterThan(0);
    expect(r.pagination.keysSeen).toContain("continuation");
    // Fixture order costs are pre-refund for the partially refunded order.
    expect(r.partialRefunds).toMatchObject({ orders: 1, orderGrossEqualsAllTickets: 1 });
    expect(r.findings.join("\n")).toMatch(/PRE-refund/);
    expect(r.findings.join("\n")).toMatch(/All order status values are mapped/);
  });

  it("flags a wrong organization and non-integer money as blockers", async () => {
    const data = pilotFixture();
    (data[0]!.orders[0]!.costs!.gross as { value: number }).value = 12.5;
    const r = await probeEventbrite(client(data), { organizationId: "someone-else", eventId: "fx-1001" });
    expect(r.findings.filter((f) => f.startsWith("BLOCKER"))).toHaveLength(2);
  });

  it("detects a default attendee listing that hides refunded tickets", async () => {
    const r = await probeEventbrite(client(pilotFixture(1), "attending"), { organizationId: FIXTURE_ACCOUNT_ID, eventId: "fx-1001" });
    expect(r.findings.join("\n")).toMatch(/BLOCKER: the default attendee listing appears to EXCLUDE/);
  });

  it("never emits IDs or patron data", async () => {
    const data = pilotFixture(1);
    Object.assign(data[0]!.attendees[0]!, { profile: { email: "buyer@example.com", name: "Pat Patron" }, barcodes: [{ barcode: "123456789012" }] });
    const r = await probeEventbrite(client(data), { organizationId: FIXTURE_ACCOUNT_ID, eventId: "fx-1001" });
    const out = JSON.stringify(r) + probeToMarkdown(r);
    expect(out).not.toMatch(/buyer@example\.com|Pat Patron|123456789012|fx-1001-o0/);
    // Field NAMES may appear (that is the point), values may not.
    expect(r.attendees.topLevelKeys).toContain("profile");
  });
});
