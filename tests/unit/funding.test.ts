import { describe, expect, it } from "vitest";
import { computeFundingPosition, formatCents, operatingView, sourcesAndUses, type FinancialLine } from "@/lib/domain/funding";

describe("test 12: synthetic funding reconciliation", () => {
  const commitments = [
    { id: "c1", funder: "SYNTHETIC A", stage: "binding_commitment" as const, amount_cents: 10_000_000, restricted_to: "acquisition" as const, expires_on: null },
    { id: "c2", funder: "SYNTHETIC B", stage: "conditional_pledge" as const, amount_cents: 5_000_000, restricted_to: null, expires_on: null },
  ];
  const receipts = [{ id: "r1", commitment_id: "c1", amount_cents: 4_000_000, received_on: "2026-11-01" }];

  it("$100k binding with $40k received = $40k cash + $60k remaining, not $140k", () => {
    const f = computeFundingPosition(commitments, receipts, null, "2026-11-15");
    expect(f.cashReceivedCents).toBe(4_000_000);
    expect(f.remainingCommittedCents).toBe(6_000_000);
    expect(f.securedCents).toBe(10_000_000);
    expect(f.conditionalPledgesCents).toBe(5_000_000);
  });

  it("unknown capital target gives unknown gap", () => {
    expect(computeFundingPosition(commitments, receipts, null, "2026-11-15").gapCents).toBeNull();
    expect(computeFundingPosition(commitments, receipts, 80_000_000, "2026-11-15").gapCents).toBe(70_000_000);
  });

  it("over-receipt never yields negative remaining; expired commitments drop out", () => {
    const f = computeFundingPosition(
      [...commitments, { id: "c3", funder: "S", stage: "binding_commitment", amount_cents: 1_000, restricted_to: "operating", expires_on: "2026-01-01" }],
      [{ id: "r1", commitment_id: "c1", amount_cents: 12_000_000, received_on: "2026-11-01" }],
      null,
      "2026-11-15",
    );
    expect(f.remainingCommittedCents).toBe(0);
    expect(f.securedCents).toBe(12_000_000);
    expect(f.expiredCommitmentIds).toEqual(["c3"]);
  });

  it("a binding commitment of unknown amount makes the gap unknown", () => {
    const f = computeFundingPosition([{ id: "x", funder: "S", stage: "binding_commitment", amount_cents: null, restricted_to: null, expires_on: null }], [], 1000, "2026-11-15");
    expect(f.securedIncomplete).toBe(true);
    expect(f.gapCents).toBeNull();
  });

  it("restrictions are tracked separately", () => {
    const f = computeFundingPosition(commitments, receipts, null, "2026-11-15");
    expect(f.byRestriction.acquisition).toEqual({ cashCents: 4_000_000, remainingCommittedCents: 6_000_000 });
  });

  it("rejects non-integer cents", () => {
    expect(() => computeFundingPosition([], [{ id: "r", commitment_id: null, amount_cents: 10.5, received_on: "2026-01-01" }], null, "2026-01-01")).toThrow(/integer cents/);
  });
});

describe("sources and uses / operating views", () => {
  const L = (o: Partial<FinancialLine>): FinancialLine => ({ id: Math.random().toString(), label: "x", line_kind: "use", boundary: "property", period: "annual", amount_cents: 0, assumption_state: "accepted", internal_transfer_key: null, ...o });

  it("rejected assumptions never enter the base case; unknowns stay unknown", () => {
    const r = sourcesAndUses([
      L({ label: "Purchase price", line_kind: "use", amount_cents: null, period: "one_time" }),
      L({ label: "Repairs", line_kind: "use", amount_cents: 5_000_000, period: "one_time" }),
      L({ label: "Rejected loan", line_kind: "source", amount_cents: 50_000_000, assumption_state: "rejected" }),
      L({ label: "Proposed grant", line_kind: "source", amount_cents: 1_000, assumption_state: "proposed" }),
    ]);
    expect(r.uses.totalCents).toBeNull();
    expect(r.uses.unknownLines).toEqual(["Purchase price"]);
    expect(r.sources.knownCents).toBe(0);
    expect(r.gapCents).toBeNull();
    expect(r.rejectedExcluded).toEqual(["Rejected loan"]);
    expect(r.proposedExcluded).toEqual(["Proposed grant"]);
  });

  it("combined view eliminates operator rent / property rent double counting", () => {
    const lines = [
      L({ label: "Operator rent to property", line_kind: "expense", boundary: "operator", amount_cents: 1_560_000, internal_transfer_key: "rent" }),
      L({ label: "Rent from operator", line_kind: "income", boundary: "property", amount_cents: 1_560_000, internal_transfer_key: "rent" }),
      L({ label: "Ticket income", line_kind: "income", boundary: "operator", amount_cents: 3_000_000 }),
      L({ label: "Insurance", line_kind: "expense", boundary: "property", amount_cents: 800_000 }),
    ];
    const combined = operatingView(lines, "combined", "annual");
    expect(combined.income.totalCents).toBe(3_000_000);
    expect(combined.expense.totalCents).toBe(800_000);
    expect(combined.eliminatedTransfers).toEqual(["rent"]);
    expect(operatingView(lines, "property", "annual").income.totalCents).toBe(1_560_000);
  });

  it("formats unknown as Not established, never $0", () => {
    expect(formatCents(null)).toBe("Not established");
    expect(formatCents(80_000_000, { comparator: "below" })).toBe("below $800,000");
    expect(formatCents(105_000_000)).toBe("$1,050,000");
  });
});
