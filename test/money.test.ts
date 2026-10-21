import { describe, expect, it } from "vitest";
import { MeasureSum, combine, currencyScale, formatMoney, formatMoneyCompact, assertMinor, parseMoneyInput } from "../src/domain/money.js";

describe("money", () => {
  it("knows currency scales", () => {
    expect(currencyScale("USD")).toBe(2);
    expect(currencyScale("JPY")).toBe(0);
    expect(currencyScale("BHD")).toBe(3);
  });
  it("formats from integers without float rounding", () => {
    expect(formatMoney(123456789, "USD")).toBe("$1,234,567.89");
    expect(formatMoney(-5, "USD")).toBe("-$0.05");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });
  it("formats compact values with integer rounding", () => {
    expect(formatMoneyCompact(81299, "USD")).toBe("$812");
    expect(formatMoneyCompact(1389885, "USD")).toBe("$13.9K");
    expect(formatMoneyCompact(1800000, "USD")).toBe("$18K");
    expect(formatMoneyCompact(99_995_000, "USD")).toBe("$1M");
    expect(formatMoneyCompact(123_456_789_00, "USD")).toBe("$123M");
    expect(formatMoneyCompact(-250000, "USD")).toBe("-$2.5K");
    expect(formatMoneyCompact(15000, "JPY")).toBe("¥15K");
  });
  it("parses typed amounts into minor units without floats", () => {
    expect(parseMoneyInput("300", "USD")).toBe(30000);
    expect(parseMoneyInput("$1,250.5", "USD")).toBe(125050);
    expect(parseMoneyInput("0.07", "USD")).toBe(7);
    expect(parseMoneyInput("1500", "JPY")).toBe(1500);
    expect(parseMoneyInput("12.345", "USD")).toBeNull();
    expect(parseMoneyInput("-5", "USD")).toBeNull();
    expect(parseMoneyInput("abc", "USD")).toBeNull();
    expect(parseMoneyInput("15.5", "JPY")).toBeNull();
  });
  it("rejects non-integer minor units", () => {
    expect(() => assertMinor(10.5, "x")).toThrow();
    expect(() => assertMinor("10", "x")).toThrow();
  });
  it("treats missing as unknown, not zero", () => {
    expect(new MeasureSum().add(100).add(null).result()).toMatchObject({ status: "partial", minor: 100, unknownCount: 1 });
    expect(new MeasureSum().add(null).result()).toMatchObject({ status: "unavailable", minor: null });
    expect(new MeasureSum().result()).toMatchObject({ status: "complete", minor: 0 });
  });
  it("propagates weakest status when combining", () => {
    const a = new MeasureSum().add(500).result();
    const b = new MeasureSum().add(null).result();
    expect(combine([{ sign: 1, m: a }, { sign: -1, m: b }]).status).toBe("unavailable");
  });
});
