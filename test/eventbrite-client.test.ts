import { describe, expect, it } from "vitest";
import { EventbriteAdapter } from "../src/providers/eventbrite/adapter.js";
import { EventbriteClient } from "../src/providers/eventbrite/client.js";
import { createFixtureTransport, FIXTURE_ACCOUNT_ID, pilotFixture } from "../src/providers/eventbrite/fixtures.js";
import { ProviderError } from "../src/providers/errors.js";

const noSleep = async () => {};
const sleeps: number[] = [];
const recSleep = async (ms: number) => { sleeps.push(ms); };

function adapter(transport: ReturnType<typeof createFixtureTransport>, extra: Record<string, unknown> = {}) {
  return new EventbriteAdapter({ token: "t", organizationId: FIXTURE_ACCOUNT_ID, fetchImpl: transport.fetch, sleep: noSleep, ...extra });
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "none"; } catch (e) { return e instanceof ProviderError ? e.kind : "other"; }
}

describe("Eventbrite adapter", () => {
  it("reads every page of a multi-page listing via continuation", async () => {
    const t = createFixtureTransport({ events: pilotFixture(), pageSize: 25 });
    const snap = await adapter(t).fetchEventSnapshot("fx-1001");
    const raw = pilotFixture()[0]!;
    expect(snap.orders).toHaveLength(raw.orders.length);
    expect(snap.lines).toHaveLength(raw.attendees.length);
    expect(t.calls.filter((c) => c.startsWith("events/fx-1001/orders/")).length).toBe(Math.ceil(raw.orders.length / 25));
    expect(t.calls.some((c) => c.includes("continuation="))).toBe(true);
  });

  it("strips patron PII fields", async () => {
    const data = pilotFixture();
    (data[0]!.attendees[0] as unknown as Record<string, unknown>).profile = { email: "buyer@example.com", name: "Someone" };
    const t = createFixtureTransport({ events: data });
    const snap = await adapter(t).fetchEventSnapshot("fx-1001");
    expect(JSON.stringify(snap)).not.toContain("buyer@example.com");
  });

  it("enforces the page bound instead of truncating silently", async () => {
    const t = createFixtureTransport({ events: pilotFixture(), pageSize: 10 });
    expect(await kindOf(adapter(t, { maxPages: 3 }).fetchEventSnapshot("fx-1001"))).toBe("limit_exceeded");
  });

  it("classifies 401 and 403 without retrying", async () => {
    const t1 = createFixtureTransport({ events: pilotFixture(), failures: [{ status: 401, body: { error: "INVALID_AUTH" } }] });
    expect(await kindOf(adapter(t1).fetchEventSnapshot("fx-1001"))).toBe("auth");
    expect(t1.calls).toHaveLength(1);
    const t2 = createFixtureTransport({ events: pilotFixture(), failures: [{ status: 403, body: { error: "NOT_AUTHORIZED" } }] });
    expect(await kindOf(adapter(t2).fetchEventSnapshot("fx-1001"))).toBe("forbidden");
    expect(t2.calls).toHaveLength(1);
  });

  it("retries 429 honoring Retry-After, then succeeds", async () => {
    sleeps.length = 0;
    const t = createFixtureTransport({ events: pilotFixture(), failures: [{ status: 429, headers: { "retry-after": "2" } }] });
    const snap = await adapter(t, { sleep: recSleep }).fetchEventSnapshot("fx-1002");
    expect(snap.orders.length).toBeGreaterThan(0);
    expect(sleeps[0]).toBe(2000);
  });

  it("gives up on persistent 429 after bounded retries", async () => {
    const t = createFixtureTransport({ events: pilotFixture(), failFor: () => ({ status: 429 }) });
    expect(await kindOf(adapter(t, { maxRetries: 2 }).fetchEventSnapshot("fx-1001"))).toBe("rate_limited");
    expect(t.calls).toHaveLength(3);
  });

  it("classifies timeouts after bounded retries", async () => {
    const t = createFixtureTransport({ events: pilotFixture(), failFor: () => "timeout" });
    expect(await kindOf(adapter(t, { maxRetries: 1 }).fetchEventSnapshot("fx-1001"))).toBe("timeout");
    expect(t.calls).toHaveLength(2);
  });

  it("refuses an event owned by a different organization", async () => {
    const t = createFixtureTransport({ events: pilotFixture() });
    const a = new EventbriteAdapter({ token: "t", organizationId: "another-org", fetchImpl: t.fetch, sleep: noSleep });
    expect(await kindOf(a.fetchEventSnapshot("fx-1001"))).toBe("forbidden");
  });

  it("refuses to construct without a token", () => {
    expect(() => new EventbriteClient({ token: "" })).toThrow(ProviderError);
  });

  it("only ever issues GET requests", async () => {
    const t = createFixtureTransport({ events: pilotFixture() });
    await expect(t.fetch("https://www.eventbriteapi.com/v3/users/me/", { method: "POST" })).rejects.toThrow(/only GET/);
  });
});
