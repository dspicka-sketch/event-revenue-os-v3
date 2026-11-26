// Underplay deal estimate for a booking prospect (DECISIONS D20).
// An estimate for deciding who to approach and at what ticket price. It is never revenue, a settlement
// or an actual, and real deal terms still come from Prism (D14). All amounts are integer minor units.
import type { MinorUnits } from "./money.js";

export interface UnderplayRules {
  currency: string;
  /** Seats sold in the room being booked. */
  roomSeats: number;
  /** Highest face price the owner will charge, and only for an exceptional booking. */
  ceilingFaceMinor: MinorUnits;
  /** Guarantee as a share of gross potential, in basis points. */
  guaranteeShareBp: number;
  /** Promoter profit as a share of gross receipts, inside break-even, in basis points. */
  promoterProfitBp: number;
  /** The share of its own door an act usually keeps, in basis points. */
  artistDoorShareBp: number;
  /** Low end of how full the act's usual room is, in basis points. The high end is a sellout. */
  sellThroughLowBp: number;
  /** ASSUMPTION, not confirmed by the owner: show costs taken off the door before the artist's share. */
  showCostsMinor: MinorUnits;
  /** ASSUMPTION, not confirmed by the owner: fans pay up to this multiple of the act's usual ticket, in basis points. */
  supportedMultipleBp: number;
}

/**
 * Daniel Spicka's underplay model, 2026-11-20: work back from gross potential; guarantee 50% of it;
 * the artist takes 100% after break-even, where break-even is the guarantee, show costs and a 15%
 * promoter profit on gross receipts; an act that fills its usual room keeps about 80% of that door;
 * 250 a ticket is the ceiling. Facility and ticketing fees sit on top of face and are not in this math.
 */
export const WAX_POETIC_UNDERPLAY: UnderplayRules = {
  currency: "USD",
  roomSeats: 60,
  ceilingFaceMinor: 25_000,
  guaranteeShareBp: 5_000,
  promoterProfitBp: 1_500,
  artistDoorShareBp: 8_000,
  sellThroughLowBp: 6_000,
  showCostsMinor: 100_000,
  supportedMultipleBp: 25_000,
};

const BP = 10_000;
/** Offers are quoted in whole five-unit steps of the currency (500 minor units at scale 2). */
const FACE_STEP_MINOR = 500;

export interface UnderplayOffer {
  faceMinor: MinorUnits;
  grossPotentialMinor: MinorUnits;
  guaranteeMinor: MinorUnits;
  promoterProfitMinor: MinorUnits;
  /** What the artist walks with if every seat sells: gross less show costs and promoter profit. */
  artistAtSelloutMinor: MinorUnits;
}

/** The offer at one face price, assuming a sellout. */
export function offerAt(faceMinor: MinorUnits, rules: UnderplayRules): UnderplayOffer {
  const grossPotentialMinor = faceMinor * rules.roomSeats;
  const guaranteeMinor = Math.floor((grossPotentialMinor * rules.guaranteeShareBp) / BP);
  const promoterProfitMinor = Math.floor((grossPotentialMinor * rules.promoterProfitBp) / BP);
  // The guarantee is a floor: a sellout never pays the artist less than it.
  const artistAtSelloutMinor = Math.max(guaranteeMinor, grossPotentialMinor - rules.showCostsMinor - promoterProfitMinor);
  return { faceMinor, grossPotentialMinor, guaranteeMinor, promoterProfitMinor, artistAtSelloutMinor };
}

/** The face price at which a sellout pays the artist `targetMinor`, rounded up to a whole minor unit. */
export function faceNeededFor(targetMinor: MinorUnits, rules: UnderplayRules): MinorUnits {
  return Math.ceil(((targetMinor + rules.showCostsMinor) * BP) / (rules.roomSeats * (BP - rules.promoterProfitBp)));
}

export type UnderplayFit = "fits" | "stretch" | "over" | "unknown";

export interface UnderplayEstimate {
  fit: UnderplayFit;
  currency: string;
  /** The act's listed ticket price at its usual room. It may include fees. Null when not listed. */
  usualPriceMinor: MinorUnits | null;
  usualRoom: number | null;
  /** Face price that matches the act's usual night at the low sell-through, and at a sellout. */
  neededFaceLowMinor: MinorUnits | null;
  neededFaceHighMinor: MinorUnits | null;
  /** What fans may pay, from the supported multiple, never above the ceiling. */
  supportedFaceMinor: MinorUnits | null;
  /** The offer at the supported price, rounded down to a five-unit step. */
  offer: UnderplayOffer | null;
}

/**
 * Compare what the math needs with what fans may pay.
 * - fits: the low needed price is within what fans may pay.
 * - stretch: the math works under the ceiling, but above what fans may pay.
 * - over: even the low needed price is above the ceiling.
 * - unknown: no listed price or room size. Missing is unknown, never zero.
 * `priceMin` is in major units as the area calendar lists it.
 */
export function estimateUnderplay(show: { priceMin: number | null; venueCapacity: number | null }, rules: UnderplayRules): UnderplayEstimate {
  const usualPriceMinor = show.priceMin !== null && Number.isFinite(show.priceMin) && show.priceMin > 0 ? Math.round(show.priceMin * 100) : null;
  const usualRoom = show.venueCapacity !== null && show.venueCapacity > 0 ? show.venueCapacity : null;
  if (usualPriceMinor === null || usualRoom === null) {
    return { fit: "unknown", currency: rules.currency, usualPriceMinor, usualRoom, neededFaceLowMinor: null, neededFaceHighMinor: null, supportedFaceMinor: null, offer: null };
  }
  const usualNight = (sellThroughBp: number) =>
    Math.floor((Math.floor((usualRoom * sellThroughBp) / BP) * usualPriceMinor * rules.artistDoorShareBp) / BP);
  const neededFaceLowMinor = faceNeededFor(usualNight(rules.sellThroughLowBp), rules);
  const neededFaceHighMinor = faceNeededFor(usualNight(BP), rules);
  const supportedFaceMinor = Math.min(rules.ceilingFaceMinor, Math.round((usualPriceMinor * rules.supportedMultipleBp) / BP));
  const offerFace = Math.max(FACE_STEP_MINOR, Math.floor(supportedFaceMinor / FACE_STEP_MINOR) * FACE_STEP_MINOR);
  const fit: UnderplayFit = neededFaceLowMinor <= supportedFaceMinor ? "fits" : neededFaceLowMinor <= rules.ceilingFaceMinor ? "stretch" : "over";
  return { fit, currency: rules.currency, usualPriceMinor, usualRoom, neededFaceLowMinor, neededFaceHighMinor, supportedFaceMinor, offer: offerAt(offerFace, rules) };
}
