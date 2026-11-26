import { afterAll, beforeAll, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { addWatchArtists, createOrganization, listCandidates, listWatchArtists, setCandidateStage, upsertCandidates } from "../src/db/repo.js";
import type { Candidate } from "../src/domain/discovery.js";
import { describeDb, freshDb } from "./helpers/db.js";

const T1 = new Date("2026-11-16T12:00:00Z");
const T2 = new Date("2026-11-17T12:00:00Z");
const cand = (over: Partial<Candidate> = {}): Candidate => ({
  artistKey: "the deslondes", artist: "The Deslondes", origin: "small_room", score: 2, reasons: ["plays rooms of 250"],
  anchorShow: { sourceEventId: "e1", headliner: "The Deslondes", support: [], venueName: "The Chapel", city: "San Francisco", venueCapacity: 250, startsAt: "2026-12-01T04:00:00Z", genre: null, priceMin: null, status: "onsale", ticketUrl: null },
  ...over,
});

describeDb("discovery candidate log", () => {
  let db: Db;
  let orgA: string;
  let orgB: string;
  beforeAll(async () => {
    db = await freshDb();
    orgA = (await createOrganization(db, { name: "Wax Poetic", isFixture: false })).id;
    orgB = (await createOrganization(db, { name: "Other Room", isFixture: false })).id;
  });
  afterAll(async () => { await db.end(); });

  it("adds a new act at the research stage", async () => {
    expect(await upsertCandidates(db, orgA, [cand()], T1)).toEqual({ added: 1, refreshed: 0 });
    const [row] = await listCandidates(db, orgA);
    expect(row).toMatchObject({ artist: "The Deslondes", origin: "small_room", stage: "research", score: 2, reasons: ["plays rooms of 250"], method: "discovery v0.2", dismissed_at: null });
    expect(row!.anchor.venueName).toBe("The Chapel");
    expect(row!.first_seen_at.toISOString()).toBe(T1.toISOString());
  });

  it("does not duplicate the act on a second run and refreshes its score", async () => {
    expect(await upsertCandidates(db, orgA, [cand({ score: 5, reasons: ["sold out at The Chapel", "plays rooms of 250"] })], T2)).toEqual({ added: 0, refreshed: 1 });
    const rows = await listCandidates(db, orgA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 5 });
    expect(rows[0]!.first_seen_at.toISOString()).toBe(T1.toISOString());
    expect(rows[0]!.last_seen_at.toISOString()).toBe(T2.toISOString());
  });

  it("keeps stage and notes when a contacted act reappears", async () => {
    const [row] = await listCandidates(db, orgA);
    expect(await setCandidateStage(db, orgA, row!.id, { stage: "initial_outreach", notes: "emailed agent" }, T2)).toBe(true);
    await upsertCandidates(db, orgA, [cand({ score: 1 })], T2);
    expect((await listCandidates(db, orgA))[0]).toMatchObject({ stage: "initial_outreach", notes: "emailed agent", score: 1 });
  });

  it("rejects a stage that is not one of the ten", async () => {
    const [row] = await listCandidates(db, orgA);
    await expect(setCandidateStage(db, orgA, row!.id, { stage: "vibes" as never }, T2)).rejects.toThrow();
  });

  it("hides dismissed acts by default and keeps them dismissed when they reappear", async () => {
    await upsertCandidates(db, orgA, [cand({ artistKey: "act b", artist: "Act B" })], T2);
    const b = (await listCandidates(db, orgA)).find((r) => r.artist === "Act B")!;
    await setCandidateStage(db, orgA, b.id, { dismissed: true }, T2);
    await upsertCandidates(db, orgA, [cand({ artistKey: "act b", artist: "Act B" })], T2);
    expect((await listCandidates(db, orgA)).map((r) => r.artist)).toEqual(["The Deslondes"]);
    expect((await listCandidates(db, orgA, { includeDismissed: true })).map((r) => r.artist).sort()).toEqual(["Act B", "The Deslondes"]);
  });

  it("filters to acts first seen since a date", async () => {
    expect((await listCandidates(db, orgA, { firstSeenSince: T2, includeDismissed: true })).map((r) => r.artist)).toEqual(["Act B"]);
  });

  it("keeps one organization's candidates away from another", async () => {
    const [row] = await listCandidates(db, orgA);
    expect(await listCandidates(db, orgB)).toEqual([]);
    expect(await setCandidateStage(db, orgB, row!.id, { stage: "booked" }, T2)).toBe(false);
    expect((await listCandidates(db, orgA))[0]!.stage).toBe("initial_outreach");
  });

  it("stores a watchlist per organization without duplicates", async () => {
    expect(await addWatchArtists(db, orgA, [{ name: "Ovrkast.", genre: "Hip-hop" }, { name: "Mack Keane" }], "historical")).toBe(2);
    expect(await addWatchArtists(db, orgA, [{ name: "OVRKAST" }], "historical")).toBe(0);
    expect(await listWatchArtists(db, orgA)).toEqual([{ artistKey: "mack keane", name: "Mack Keane" }, { artistKey: "ovrkast", name: "Ovrkast." }]);
    expect(await listWatchArtists(db, orgB)).toEqual([]);
  });
});
