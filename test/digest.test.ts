import { describe, expect, it } from "vitest";
import { buildDigest, type DigestInput } from "../src/domain/digest.js";
import { buildOrgPulse, type ShowInput } from "../src/domain/pulse.js";
import { computeEventRevenue } from "../src/domain/revenue.js";
import { normalizeAttendee, normalizeOrder } from "../src/providers/eventbrite/normalize.js";
import { attendees, costs, order } from "./helpers/build.js";

const NOW = new Date("2026-10-20T19:00:00Z"); // Tue Oct 20, 12:00 PDT
const TZ = "America/Los_Angeles";

function revenue(qty: number) {
  const lc = Array.from({ length: qty }, () => costs(2500, 271, 80, 0));
  return computeEventRevenue([normalizeOrder(order("o1", "e1", lc, { created: "2026-10-19T20:00:00Z" }), "USD")], attendees("o1", "e1", lc).map((a) => normalizeAttendee(a, "USD")), { proceedsPolicy: "unverified", asOf: NOW, timeZone: TZ });
}
function show(over: Partial<ShowInput> = {}): ShowInput {
  return {
    id: "e1", name: "Open Decks", performanceStartUtc: "2026-10-31T03:00:00Z", venueTimezone: TZ, provider: "eventbrite", mode: "live",
    connectionStatus: "verified", connectionStatusKind: null, connectionAction: null, stale: false, dataAsOf: "2026-10-20T18:00:00Z",
    revenue: revenue(7), reportComparison: null, targets: [], marketing: null, marketingLast7Days: null, ...over,
  };
}
function digest(shows: ShowInput[], over: Partial<DigestInput> = {}) {
  return buildDigest({ organizationName: "Wax Poetic", pulse: buildOrgPulse(shows, NOW), lastSweepSucceededAt: new Date("2026-10-20T11:30:00Z"), lastSweepFailures: [], newCandidates: [], now: NOW, ...over });
}

describe("weekly digest", () => {
  it("names the organization and how many shows need attention in the subject", () => {
    const d = digest([show(), show({ id: "e2", name: "Never synced", revenue: null, dataAsOf: null })]);
    expect(d.subject).toBe("Wax Poetic weekly digest: 1 of 2 shows need attention");
  });

  it("says so in the subject when nothing needs attention", () => {
    expect(digest([show()]).subject).toBe("Wax Poetic weekly digest: 1 show, nothing needs attention");
  });

  it("lists each show with its venue-local date, paid tickets and gross", () => {
    const text = digest([show()]).text;
    expect(text).toContain("Open Decks\n  Fri, Oct 30, 2026 · in 10 days");
    expect(text).toContain("  Paid tickets: 7");
    expect(text).toContain("  Gross after refunds: $199.57");
    expect(text).toContain("  Last 7 days: 7 paid (prior 7 days: 0)");
  });

  it("leads with a warning when the last successful sweep is older than 36 hours", () => {
    const text = digest([show()], { lastSweepSucceededAt: new Date("2026-10-18T19:00:00Z") }).text;
    expect(text.split("\n")[0]).toBe("WARNING: automatic sync has not succeeded since Sun, Oct 18, 2026, 12:00 PM PDT. Figures below may be out of date.");
  });

  it("does not warn at exactly 36 hours", () => {
    expect(digest([show()], { lastSweepSucceededAt: new Date("2026-10-19T07:00:00Z") }).text.startsWith("WARNING")).toBe(false);
  });

  it("leads with a warning when there has never been a sweep", () => {
    expect(digest([show()], { lastSweepSucceededAt: null }).text.split("\n")[0]).toBe("WARNING: automatic sync has never run.");
  });

  it("lists each sweep failure by show name and kind", () => {
    const text = digest([show()], { lastSweepFailures: [{ name: "Open Decks", kind: "auth", message: "The access token was rejected." }] }).text;
    expect(text).toContain("WARNING: the last sync could not refresh 1 show:\n  - Open Decks (auth): The access token was rejected.");
  });

  it("shows unknown gross as unavailable, never as 0", () => {
    const text = digest([show({ revenue: null, dataAsOf: null })]).text;
    expect(text).toContain("  Paid tickets: unavailable");
    expect(text).toContain("  Gross after refunds: unavailable");
    expect(text).not.toContain("$0.00");
  });

  it("lists a show with no performance date under date unknown", () => {
    expect(digest([show({ performanceStartUtc: null })]).text).toContain("Open Decks\n  Date unknown");
  });

  it("lists attention items under their show", () => {
    expect(digest([show({ id: "e2", name: "Never synced", revenue: null, dataAsOf: null })]).text).toMatch(/Never synced\n(  .*\n)+  ! /);
  });

  it("says there are no upcoming shows and still gives the data-as-of line", () => {
    const text = digest([]).text;
    expect(text).toContain("No upcoming shows.");
    expect(text).toContain("Data as of: last successful sync Tue, Oct 20, 2026, 4:30 AM PDT.");
  });

  it("lists new underplay candidates with their reasons, capped at 10", () => {
    const c = (i: number) => ({ artist: `Act ${i}`, origin: "small_room" as const, reasons: ["plays rooms of 250"], anchorVenue: "The Chapel", anchorCity: "San Francisco", anchorStartsAt: "2026-12-01T04:00:00Z" });
    const text = digest([show()], { newCandidates: [{ ...c(0), artist: "Mack Keane", origin: "watchlist", reasons: ["on your watchlist"] }, ...Array.from({ length: 11 }, (_, i) => c(i + 1))] }).text;
    expect(text).toContain("New underplay candidates this week (12):");
    expect(text).toContain("  - Mack Keane [watchlist]: The Chapel, San Francisco, Mon, Nov 30, 2026. on your watchlist");
    expect(text).toContain("  - Act 9: The Chapel");
    expect(text).not.toContain("Act 10");
    expect(text).toContain("  ...and 2 more in the candidate list.");
    expect(text).toContain("Scores use discovery v0.2, a starting method that has not been approved.");
  });

  it("says when there are no new candidates", () => {
    expect(digest([show()]).text).toContain("No new underplay candidates this week.");
  });
});
