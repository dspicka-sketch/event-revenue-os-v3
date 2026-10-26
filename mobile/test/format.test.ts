import { describe, expect, it } from "vitest";
import { measureCompact, whenLabel } from "../src/lib/format";

describe("mobile display helpers", () => {
  it("labels show timing", () => {
    expect(whenLabel({ phase: "today", daysUntil: 0 })).toBe("Tonight");
    expect(whenLabel({ phase: "upcoming", daysUntil: 1 })).toBe("Tomorrow");
    expect(whenLabel({ phase: "upcoming", daysUntil: 24 })).toBe("In 24 days");
    expect(whenLabel({ phase: "past", daysUntil: -3 })).toBe("3 days ago");
  });
  it("never shows a number for unavailable measures and marks partial ones", () => {
    expect(measureCompact({ status: "unavailable", minor: null, knownCount: 0, unknownCount: 0 }, "USD")).toBe("Unavailable");
    expect(measureCompact({ status: "partial", minor: 1389885, knownCount: 3, unknownCount: 1 }, "USD")).toBe("$13.9K*");
    expect(measureCompact({ status: "complete", minor: 1389885, knownCount: 3, unknownCount: 0 }, null)).toBe("Unavailable");
  });
});
