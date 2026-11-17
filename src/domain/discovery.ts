// Underplay discovery rules (D19). Pure: no I/O.
//
// Two origins feed one candidate list: acts on the organization's watchlist that
// have an area date, and acts already playing small rooms nearby. The score is a
// transparent sum of signals, each with a plain reason. The weights are
// "discovery v0": a starting proposal that the owner has not approved.

export const DISCOVERY_METHOD = "discovery v0";

/** Relationship stages, in order. A person moves a candidate through them; the job never does. */
export const CANDIDATE_STAGES = [
  "research", "representation_identified", "initial_outreach", "conversation_started", "routing_discussion",
  "offer_submitted", "negotiation", "booked", "repeat_artist", "long_term_relationship",
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export type AreaShowStatus = "onsale" | "low" | "soldout" | "cancelled" | "postponed";

/** One upcoming show in the area, as read from an area calendar such as Bay Shows. */
export interface AreaShow {
  sourceEventId: string;
  headliner: string;
  support: string[];
  venueName: string;
  city: string;
  /** Unknown is null, never a guess. */
  venueCapacity: number | null;
  /** ISO timestamp (UTC). */
  startsAt: string;
  genre: string | null;
  priceMin: number | null;
  status: AreaShowStatus;
  ticketUrl: string | null;
}

export interface DiscoveryRules {
  maxVenueCapacity: number;
  windowDays: number;
  /** Lowercase substrings of venue names that are never a source. */
  excludedVenues: string[];
  /** Artist names that are never candidates (compared as artist keys). */
  excludedArtists: string[];
  /** Seats in the room being booked. Not used in scoring yet; kept with the rules for economics. */
  roomSeats: number;
}

/** Daniel's August 2026 underplay rules. The 600 ceiling is a starting value, not his. */
export const WAX_POETIC_RULES: DiscoveryRules = {
  maxVenueCapacity: 600,
  windowDays: 90,
  excludedVenues: ["hopmonk"],
  excludedArtists: ["jason isbell", "chris thile"],
  roomSeats: 60,
};

export interface WatchArtist {
  artistKey: string;
  name: string;
}

export type CandidateOrigin = "watchlist" | "small_room";

export interface Candidate {
  artistKey: string;
  artist: string;
  origin: CandidateOrigin;
  /** The act's soonest qualifying show. */
  anchorShow: AreaShow;
  score: number;
  reasons: string[];
}

/** Stable identity for an act across spellings: lowercase, "&" as "and", no accents or punctuation. */
export function artistKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Ovrkast. — Still Striking Tour" → "Ovrkast." */
function cleanHeadliner(headliner: string): string {
  return (headliner.split(/\s+[—–-]\s+|:\s+/)[0] ?? headliner).trim();
}

/** A one-word watch name must equal the billed name; longer names may sit inside a longer billing. */
function matchesWatch(watchKey: string, billedKey: string): boolean {
  if (!watchKey || !billedKey) return false;
  if (watchKey === billedKey) return true;
  if (!watchKey.includes(" ")) return false;
  return ` ${billedKey} `.includes(` ${watchKey} `);
}

interface Hit {
  key: string;
  artist: string;
  origin: CandidateOrigin;
  show: AreaShow;
  supporting: string | null;
}

export function selectCandidates(shows: AreaShow[], rules: DiscoveryRules, now: Date, watchlist: WatchArtist[] = []): Candidate[] {
  const from = now.getTime();
  const until = from + rules.windowDays * 86400_000;
  const excludedKeys = rules.excludedArtists.map(artistKey).filter(Boolean);
  /** An excluded act stays excluded when billed with a band or guests ("Jason Isbell and the 400 Unit"). */
  const isExcluded = (key: string) => excludedKeys.some((x) => matchesWatch(x, key));
  const hits: Hit[] = [];

  for (const show of shows) {
    if (show.status === "cancelled" || show.status === "postponed") continue;
    const at = Date.parse(show.startsAt);
    if (!Number.isFinite(at) || at <= from || at > until) continue;
    const venue = show.venueName.toLowerCase();
    if (rules.excludedVenues.some((v) => venue.includes(v))) continue;

    const billed = cleanHeadliner(show.headliner);
    const billedKey = artistKey(billed);
    const fullKey = artistKey(show.headliner);
    // A watched act billed with extra words ("X with special guests") is one watchlist hit, not also a small-room act.
    let headlinerWatched = false;
    for (const w of watchlist) {
      if (isExcluded(w.artistKey)) continue;
      if (matchesWatch(w.artistKey, billedKey) || matchesWatch(w.artistKey, fullKey)) {
        hits.push({ key: w.artistKey, artist: billedKey === w.artistKey ? billed : w.name, origin: "watchlist", show, supporting: null });
        headlinerWatched = true;
      } else if (show.support.some((s) => matchesWatch(w.artistKey, artistKey(s)))) {
        hits.push({ key: w.artistKey, artist: w.name, origin: "watchlist", show, supporting: billed });
      }
    }
    if (headlinerWatched || !billedKey || isExcluded(billedKey) || isExcluded(fullKey)) continue;
    if (show.venueCapacity === null || show.venueCapacity > rules.maxVenueCapacity) continue;
    hits.push({ key: billedKey, artist: billed, origin: "small_room", show, supporting: null });
  }

  const byArtist = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byArtist.get(h.key);
    if (list) list.push(h);
    else byArtist.set(h.key, [h]);
  }

  const out: Candidate[] = [];
  for (const [key, list] of byArtist) {
    list.sort((a, b) => Date.parse(a.show.startsAt) - Date.parse(b.show.startsAt));
    const first = list[0]!;
    const watchHit = list.find((h) => h.origin === "watchlist");
    const origin: CandidateOrigin = watchHit ? "watchlist" : "small_room";
    const show = first.show;
    const reasons: string[] = [];
    let score = 0;
    if (origin === "watchlist") { score += 5; reasons.push("on your watchlist"); }
    if (first.supporting) reasons.push(`supporting ${first.supporting}`);
    if (!first.supporting) {
      if (show.status === "soldout") { score += 3; reasons.push(`sold out at ${show.venueName}`); }
      else if (show.status === "low") { score += 2; reasons.push(`low tickets at ${show.venueName}`); }
      if (show.venueCapacity !== null && show.venueCapacity <= 300) { score += 2; reasons.push(`plays rooms of ${show.venueCapacity}`); }
    }
    const dates = new Set(list.map((h) => h.show.sourceEventId)).size;
    if (dates > 1) { score += 1; reasons.push(`${dates} area dates`); }
    if (!first.supporting && show.priceMin !== null && show.priceMin >= 30) { score += 1; reasons.push(`tickets from $${show.priceMin}`); }
    out.push({ artistKey: key, artist: (watchHit ?? first).artist, origin, anchorShow: show, score, reasons });
  }

  return out.sort((a, b) => b.score - a.score || Date.parse(a.anchorShow.startsAt) - Date.parse(b.anchorShow.startsAt));
}
