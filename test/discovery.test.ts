import { describe, expect, it } from "vitest";
import { artistKey, DISCOVERY_METHOD, selectCandidates, WAX_POETIC_RULES, type AreaShow, type WatchArtist, leadTime, nonTouringFormat, SHORT_LEAD_DAYS } from "../src/domain/discovery.js";

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
    expect(out[0]).toMatchObject({ artist: "The Deslondes", artistKey: "the deslondes", origin: "small_room", score: 1, reasons: ["deal is a stretch: needs about $137.26, fans may pay about $62.50"] });
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
    expect(out[0]!.score).toBe(2);
  });

  it("scores a sold-out 250-capacity show at 5 for its signals, plus the deal point", () => {
    const out = pick([show({ status: "soldout", venueCapacity: 250, venueName: "The Chapel" })]);
    expect(out[0]!.score).toBe(6);
    expect(out[0]!.reasons).toEqual(["sold out at The Chapel", "plays rooms of 250", "deal is a stretch: needs about $78.44, fans may pay about $62.50"]);
  });

  it("adds a point for low tickets (2) and for a price of $30 or more (1)", () => {
    const out = pick([show({ status: "low", priceMin: 30 })]);
    expect(out[0]!.score).toBe(4);
    expect(out[0]!.reasons).toEqual(["low tickets at Mystic Theatre", "tickets from $30", "deal is a stretch: needs about $160.79, fans may pay about $75.00"]);
  });

  it("reduces a cabaret-room show by one point and says so", () => {
    const out = pick([show({ venueName: "Feinstein's at the Nikko", venueCapacity: 140, priceMin: 86 })]);
    expect(out[0]!.score).toBe(4);
    expect(out[0]!.reasons).toEqual(["plays rooms of 140", "tickets from $86", "cabaret room (reduced)", "deal fits: needs about $132.93, fans may pay about $215.00"]);
  });

  it("keeps promoter billings as candidates", () => {
    expect(pick([show({ headliner: "Moe's Alley Presents", venueName: "Moe's Alley", venueCapacity: 250 })]).map((c) => c.artist)).toEqual(["Moe's Alley Presents"]);
  });

  it("names the scoring method version", () => {
    expect(DISCOVERY_METHOD).toBe("discovery v0.4");
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

describe("lead time flag", () => {
  const now = new Date("2026-11-20T17:00:00Z");
  it("counts whole days until the show", () => {
    expect(leadTime("2026-11-21T17:00:00Z", now).daysUntilShow).toBe(1);
    expect(leadTime("2026-11-21T16:59:00Z", now).daysUntilShow).toBe(0);
    expect(leadTime("2026-11-19T17:00:00Z", now).daysUntilShow).toBe(-1);
  });
  it("flags a show under 30 days out and not one at 30 days or more", () => {
    expect(SHORT_LEAD_DAYS).toBe(30);
    expect(leadTime("2026-12-20T16:59:00Z", now)).toEqual({ daysUntilShow: 29, shortLead: true });
    expect(leadTime("2026-12-20T17:00:00Z", now)).toEqual({ daysUntilShow: 30, shortLead: false });
  });
});

describe("touring-format filter", () => {
  const NOW2 = new Date("2026-11-26T00:00:00Z");
  const at = (headliner: string, over: Partial<AreaShow> = {}): AreaShow => ({
    sourceEventId: headliner, headliner, support: [], venueName: "Room", city: "San Francisco", venueCapacity: 300,
    startsAt: "2026-12-20T04:00:00Z", genre: null, priceMin: null, status: "onsale", ticketUrl: null, ...over,
  });
  const artists = (shows: AreaShow[]) => selectCandidates(shows, WAX_POETIC_RULES, NOW2).map((c) => c.artist);

  it("drops formats that are not a touring act", () => {
    for (const t of ["Karaoke Tuesday", "Open Mic Night", "The Official Santa Con SF Bar Crawl", "2000's Night", "The Emo Night Tour", "Kawaii Rave",
      "Gimme Gimme Disco", "Moe's Alley's NYE Bash with Wooster!", "The Rock and Roll Playhouse: Music of Bob Marley", "Big Bad Bitchfest 3 (Night 1)",
      "Country For A Cause: A Benefit for the Food Bank"]) {
      expect(nonTouringFormat(t), t).not.toBeNull();
    }
    expect(artists([at("Karaoke Tuesday"), at("Kawaii Rave")])).toEqual([]);
  });

  it("keeps music, comedy and other touring performance", () => {
    for (const t of ["Keller Williams", "Cliff Cash", "Felton Comedy Night", "A John Waters Christmas", "Reality Gays: Same Gays, New Wigs", "The Night Owls",
      "Oakland Interfaith Gospel Choir", "Full Circle Boys - Day 1 Tour Experience", "Moe's Alley Presents: Kabaka Pyramid (Night 1) w/ Kava Jah & The Remedy + Selecta 7"]) {
      expect(nonTouringFormat(t), t).toBeNull();
    }
  });

  it("keeps tribute acts and bills of several acts, listing a shared bill under its first act (owner, 2026-11-26)", () => {
    for (const t of ["Valerie: A Tribute to Amy Winehouse", "Strangelove: The Depeche Mode Experience", "Mikey Vee, Lyka B, Solus The Happy Human",
      "Cartoon Hearts/ Amity St./ Trip Drive/ Zacc & The Scissorlips", "Moe's Alley Presents a Double Bill with Anthony Arya & Anthony Cullins"]) {
      expect(nonTouringFormat(t), t).toBeNull();
    }
    expect(artists([at("Mikey Vee, Lyka B, Solus The Happy Human")])).toEqual(["Mikey Vee"]);
    expect(artists([at("Cartoon Hearts/ Amity St./ Trip Drive/ Zacc & The Scissorlips")])).toEqual(["Cartoon Hearts"]);
    expect(artists([at("Valerie: A Tribute to Amy Winehouse")])).toEqual(["Valerie"]);
  });

  it("reads the act out of presenter billings, support lines and tour titles", () => {
    expect(artists([at("Moe's Alley Presents: Kabaka Pyramid (Night 1) w/ Kava Jah & The Remedy + Selecta 7")])).toEqual(["Kabaka Pyramid"]);
    expect(artists([at("(((folkYEAH!))) Presents - The Lemon Twigs w/ Tchotchke")])).toEqual(["The Lemon Twigs"]);
    expect(artists([at("WHY? with Kitty Ray")])).toEqual(["WHY?"]);
    expect(artists([at("Cut Worms (solo)")])).toEqual(["Cut Worms"]);
    expect(artists([at("An Evening With Karl Denson's AfroSonic")])).toEqual(["Karl Denson's AfroSonic"]);
    expect(artists([at("Ovrkast. — Still Striking Tour")])).toEqual(["Ovrkast."]);
  });

  it("leaves out the venue's own nights and genres that do not suit the room", () => {
    expect(artists([at("Listening Session", { venueName: "Wax Poetic Sound Society" })])).toEqual([]);
    expect(artists([at("Conjurer", { genre: "Punk / Metal" })])).toEqual([]);
    expect(artists([at("Conjurer", { genre: "Indie / Rock" })])).toEqual(["Conjurer"]);
  });

  it("keeps a watchlist act whatever its genre", () => {
    const out = selectCandidates([at("Conjurer", { genre: "Punk / Metal" })], WAX_POETIC_RULES, NOW2, [{ artistKey: artistKey("Conjurer"), name: "Conjurer" }]);
    expect(out.map((c) => [c.artist, c.origin])).toEqual([["Conjurer", "watchlist"]]);
  });
});

describe("deal estimate in scoring (v0.4)", () => {
  it("adds nothing and says nothing when the listing has no price", () => {
    const out = pick([show({ priceMin: null })]);
    expect(out[0]).toMatchObject({ score: 0, reasons: [] });
  });
  it("says so, without points, when even the low needed price is over the ceiling", () => {
    const out = pick([show({ venueCapacity: 600, priceMin: 80 })]);
    expect(out[0]!.reasons).toContain("deal is over the $250.00 ceiling");
    expect(out[0]!.score).toBe(1);
  });
  it("gives a support act no deal estimate, since the price is the headliner's", () => {
    const out = pick([show({ headliner: "Big Name", support: ["Nora Brown"] })], [{ artistKey: artistKey("Nora Brown"), name: "Nora Brown" }]);
    const nora = out.find((c) => c.artist === "Nora Brown")!;
    expect(nora.reasons.some((x) => x.startsWith("deal "))).toBe(false);
  });
});
