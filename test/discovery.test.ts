import { describe, expect, it } from "vitest";
import { artistKey, selectCandidates, WAX_POETIC_RULES, type AreaShow, type WatchArtist } from "../src/domain/discovery.js";

const NOW = new Date("2026-11-16T12:00:00Z");

function show(over: Partial<AreaShow> = {}): AreaShow {
  return {
    sourceEventId: "e1", headliner: "The Deslondes", support: [], venueName: "Mystic Theatre", city: "Petaluma",
    venueCapacity: 500, startsAt: "2026-12-01T04:00:00Z", genre: "Folk / Americana", priceMin: 25, status: "onsale",
    ticketUrl: "https://example.com/t/e1", ...over,
  };
}
const pick = (shows: AreaShow[], watch: WatchArtist[] = []) => selectCandidates(shows, WAX_POETIC_RULES, NOW, watch);

describe("underplay discovery rules", () => {
  it("keeps an on-sale show at a small room inside the window", () => {
    const out = pick([show()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ artist: "The Deslondes", artistKey: "the deslondes", origin: "small_room", score: 0, reasons: [] });
  });

  it("drops shows at venues above the capacity ceiling", () => {
    expect(pick([show({ venueCapacity: 601 })])).toEqual([]);
  });

  it("drops shows with unknown venue capacity", () => {
    expect(pick([show({ venueCapacity: null })])).toEqual([]);
  });

  it("drops HopMonk shows and the excluded artists", () => {
    expect(pick([show({ venueName: "HopMonk Tavern Sebastopol" }), show({ sourceEventId: "e2", headliner: "Jason Isbell" }), show({ sourceEventId: "e3", headliner: "Chris Thile" })])).toEqual([]);
  });

  it("drops an excluded artist billed with a band name", () => {
    expect(pick([show({ headliner: "Jason Isbell and the 400 Unit", venueCapacity: 350 })])).toEqual([]);
  });

  it("drops cancelled and postponed shows", () => {
    expect(pick([show({ status: "cancelled" }), show({ sourceEventId: "e2", status: "postponed" })])).toEqual([]);
  });

  it("drops shows already past and shows beyond the 90-day window", () => {
    expect(pick([show({ startsAt: "2026-11-15T04:00:00Z" }), show({ sourceEventId: "e2", startsAt: "2027-03-01T04:00:00Z" })])).toEqual([]);
  });

  it("collapses one act with two dates into one candidate anchored on the sooner date", () => {
    const out = pick([show({ sourceEventId: "late", startsAt: "2026-12-20T04:00:00Z" }), show({ sourceEventId: "soon", startsAt: "2026-12-02T04:00:00Z" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.anchorShow.sourceEventId).toBe("soon");
    expect(out[0]!.reasons).toContain("2 area dates");
    expect(out[0]!.score).toBe(1);
  });

  it("scores a sold-out 250-capacity show at 5 with both reasons", () => {
    const out = pick([show({ status: "soldout", venueCapacity: 250, venueName: "The Chapel" })]);
    expect(out[0]!.score).toBe(5);
    expect(out[0]!.reasons).toEqual(["sold out at The Chapel", "plays rooms of 250"]);
  });

  it("adds a point for low tickets (2) and for a price of $30 or more (1)", () => {
    const out = pick([show({ status: "low", priceMin: 30 })]);
    expect(out[0]!.score).toBe(3);
    expect(out[0]!.reasons).toEqual(["low tickets at Mystic Theatre", "tickets from $30"]);
  });

  it("treats differently cased and punctuated names as one artist", () => {
    expect(artistKey("The Deslondes")).toBe(artistKey("  the  DESLONDES! "));
    expect(pick([show(), show({ sourceEventId: "e2", headliner: "the deslondes" })])).toHaveLength(1);
  });

  it("strips a tour name from the headliner", () => {
    expect(pick([show({ headliner: "Ovrkast. — Still Striking Tour" })])[0]).toMatchObject({ artist: "Ovrkast.", artistKey: "ovrkast" });
  });

  it("sorts by score, then by the sooner date", () => {
    const out = pick([
      show({ sourceEventId: "a", headliner: "Act A", startsAt: "2026-12-10T04:00:00Z" }),
      show({ sourceEventId: "b", headliner: "Act B", status: "soldout" }),
      show({ sourceEventId: "c", headliner: "Act C", startsAt: "2026-12-05T04:00:00Z" }),
    ]);
    expect(out.map((c) => c.artist)).toEqual(["Act B", "Act C", "Act A"]);
  });

  describe("watchlist", () => {
    const watch: WatchArtist[] = [{ artistKey: artistKey("Ovrkast."), name: "Ovrkast." }, { artistKey: artistKey("merchant"), name: "merchant" }, { artistKey: artistKey("Mack Keane"), name: "Mack Keane" }];

    it("flags a watched headliner even at a room above the ceiling or of unknown capacity", () => {
      const out = pick([show({ headliner: "Ovrkast. — Still Striking Tour", venueCapacity: 1400 }), show({ sourceEventId: "e2", headliner: "Mack Keane", venueCapacity: null })], watch);
      expect(out.map((c) => [c.artist, c.origin])).toEqual([["Ovrkast.", "watchlist"], ["Mack Keane", "watchlist"]]);
      expect(out[0]!.score).toBe(5);
      expect(out[0]!.reasons[0]).toBe("on your watchlist");
    });

    it("flags a watched act playing support", () => {
      const out = pick([show({ headliner: "Somebody Big", venueCapacity: 2000, support: ["Mack Keane"] })], watch);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ artist: "Mack Keane", origin: "watchlist" });
      expect(out[0]!.reasons).toContain("supporting Somebody Big");
    });

    it("does not match a one-word watch name inside a longer title", () => {
      expect(pick([show({ headliner: "The Merchant of Venice", venueCapacity: 2000 })], watch)).toEqual([]);
    });

    it("gives one candidate, not two, when a watched act's billing has extra words", () => {
      const out = pick([show({ headliner: "Mack Keane with special guests", venueCapacity: 350 }), show({ sourceEventId: "e2", headliner: "Mack Keane & Friends Band", venueCapacity: 350, startsAt: "2026-12-09T04:00:00Z" })], watch);
      expect(out.map((c) => [c.artist, c.origin])).toEqual([["Mack Keane", "watchlist"]]);
    });

    it("still drops watched acts at excluded venues and cancelled shows", () => {
      expect(pick([show({ headliner: "Mack Keane", venueName: "HopMonk Tavern" }), show({ sourceEventId: "e2", headliner: "Mack Keane", status: "cancelled" })], watch)).toEqual([]);
    });
  });
});

describe("handoff watchlist seed", () => {
  it("holds 44 artists with distinct artist keys", async () => {
    const { readFile } = await import("node:fs/promises");
    const seed = JSON.parse(await readFile(new URL("../scripts/data/watchlist-handoff-v6.1.json", import.meta.url), "utf8")) as { artists: { name: string }[] };
    const keys = seed.artists.map((a) => artistKey(a.name));
    expect(keys).toHaveLength(44);
    expect(new Set(keys).size).toBe(44);
    expect(keys.every((k) => k.length > 0)).toBe(true);
    expect(keys).toContain("andfriends");
    expect(keys).toContain("adela");
  });
});
