import { describe, expect, it } from "vitest";
import { fetchAreaShows } from "../src/providers/bayshows/client.js";
import { ProviderError } from "../src/providers/errors.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const row = (id: string, over: Record<string, unknown> = {}) => ({
  source_id: id, headliner: "Prayers", support: ["Devora"], venue_name: "Great American Music Hall", city: "San Francisco",
  starts_at: "2026-11-17T03:30:00+00:00", genre: "Other", price_min: null, status: "onsale", ticket_url: "https://example.com/" + id,
  venues: { capacity: 470 }, ...over,
});
function fake(pages: unknown[][], status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const body = pages[calls.length - 1] ?? [];
    return new Response(JSON.stringify(status === 200 ? body : { message: "boom" }), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const opts = (f: typeof fetch, pageSize = 2) => ({ url: "https://bay.example.co/", key: "pk_test", now: NOW, windowDays: 90, fetchImpl: f, pageSize });

describe("Bay Shows reader", () => {
  it("maps a row with an embedded venue to an AreaShow", async () => {
    const { fetchImpl, calls } = fake([[row("a")]]);
    const shows = await fetchAreaShows(opts(fetchImpl));
    expect(shows).toEqual([{
      sourceEventId: "a", headliner: "Prayers", support: ["Devora"], venueName: "Great American Music Hall", city: "San Francisco",
      venueCapacity: 470, startsAt: "2026-11-17T03:30:00+00:00", genre: "Other", priceMin: null, status: "onsale", ticketUrl: "https://example.com/a",
    }]);
    expect(calls[0]!.headers.apikey).toBe("pk_test");
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe("https://bay.example.co/rest/v1/events");
    expect(u.searchParams.getAll("starts_at")).toEqual(["gte.2026-11-16T12:00:00.000Z", "lte.2027-02-14T12:00:00.000Z"]);
    expect(u.searchParams.get("limit")).toBe("2");
    expect(u.searchParams.get("offset")).toBe("0");
  });

  it("gives null capacity when the row has no venue", async () => {
    const shows = await fetchAreaShows(opts(fake([[row("a", { venues: null })]]).fetchImpl));
    expect(shows[0]!.venueCapacity).toBeNull();
  });

  it("reads a numeric price and treats an unknown status as onsale-ineligible 'postponed'", async () => {
    const shows = await fetchAreaShows(opts(fake([[row("a", { price_min: 32.5, status: "weird" })]]).fetchImpl));
    expect(shows[0]!.priceMin).toBe(32.5);
    expect(shows[0]!.status).toBe("postponed");
  });

  it("follows pagination until a short page", async () => {
    const { fetchImpl, calls } = fake([[row("a"), row("b")], [row("c")]]);
    const shows = await fetchAreaShows(opts(fetchImpl));
    expect(shows.map((s) => s.sourceEventId)).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0", "2"]);
  });

  it("stops with limit_exceeded instead of reading forever", async () => {
    const full = [row("a"), row("b")];
    await expect(fetchAreaShows({ ...opts(fake([full, full, full, full]).fetchImpl), maxPages: 3 })).rejects.toMatchObject({ kind: "limit_exceeded" });
  });

  it("throws a ProviderError on a 500 without leaking the key", async () => {
    const err = await fetchAreaShows(opts(fake([], 500).fetchImpl)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("server");
    expect(String(err.message)).not.toContain("pk_test");
  });

  it("throws bad_response when the body is not a list", async () => {
    const f = (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as typeof fetch;
    await expect(fetchAreaShows(opts(f))).rejects.toMatchObject({ kind: "bad_response" });
  });
});
