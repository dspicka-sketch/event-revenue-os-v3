import { describe, expect, it } from "vitest";
import { estimateUnderplay, faceNeededFor, offerAt, WAX_POETIC_UNDERPLAY as R } from "../src/domain/underplay.js";

describe("underplay offer", () => {
  it("works back from gross potential at 125 a seat", () => {
    expect(offerAt(12_500, R)).toEqual({ faceMinor: 12_500, grossPotentialMinor: 750_000, guaranteeMinor: 375_000, promoterProfitMinor: 112_500, artistAtSelloutMinor: 537_500 });
  });
  it("pays 11,750 at the 250 ceiling", () => {
    expect(offerAt(25_000, R).artistAtSelloutMinor).toBe(1_175_000);
  });
  it("never pays a sellout less than the guarantee", () => {
    const o = offerAt(2_000, R);
    expect(o.guaranteeMinor).toBe(60_000);
    expect(o.artistAtSelloutMinor).toBe(60_000);
  });
  it("finds the face price for a target payout, rounding up", () => {
    expect(faceNeededFor(537_500, R)).toBe(12_500);
    expect(faceNeededFor(709_200, R)).toBe(15_867);
  });
});

describe("underplay estimate", () => {
  it("is unknown without a listed price or room size: missing is never zero", () => {
    for (const show of [{ priceMin: null, venueCapacity: 300 }, { priceMin: 0, venueCapacity: 300 }, { priceMin: 35, venueCapacity: null }]) {
      const e = estimateUnderplay(show, R);
      expect(e.fit).toBe("unknown");
      expect(e.offer).toBeNull();
      expect(e.neededFaceLowMinor).toBeNull();
    }
  });
  it("matches the worked example: a 250 room at 35.46", () => {
    const e = estimateUnderplay({ priceMin: 35.46, venueCapacity: 250 }, R);
    expect(e.usualPriceMinor).toBe(3_546);
    expect(e.neededFaceLowMinor).toBe(10_305);
    expect(e.neededFaceHighMinor).toBe(15_867);
    expect(e.supportedFaceMinor).toBe(8_865);
    expect(e.fit).toBe("stretch");
    expect(e.offer?.faceMinor).toBe(8_500);
    expect(e.offer?.guaranteeMinor).toBe(255_000);
    expect(e.offer?.artistAtSelloutMinor).toBe(333_500);
  });
  it("fits when the low needed price is within what fans may pay", () => {
    expect(estimateUnderplay({ priceMin: 24, venueCapacity: 150 }, R).fit).toBe("fits");
  });
  it("is over when even the low needed price is above the ceiling", () => {
    expect(estimateUnderplay({ priceMin: 60, venueCapacity: 700 }, R).fit).toBe("over");
  });
  it("never supports a price above the ceiling", () => {
    expect(estimateUnderplay({ priceMin: 199, venueCapacity: 500 }, R).supportedFaceMinor).toBe(25_000);
  });
  it("returns whole minor units only", () => {
    const e = estimateUnderplay({ priceMin: 33.33, venueCapacity: 333 }, R);
    for (const v of [e.usualPriceMinor, e.neededFaceLowMinor, e.neededFaceHighMinor, e.supportedFaceMinor, e.offer?.guaranteeMinor, e.offer?.artistAtSelloutMinor]) expect(Number.isInteger(v)).toBe(true);
  });
});
