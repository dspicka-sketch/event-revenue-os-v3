import { addMinor } from "../../src/domain/money";
import type { DealStage, SponsorDeal } from "./types";

// Pipeline totals follow RevOS's money rules: integer minor units, one total per
// currency (currencies are never added together), and deals without an amount
// are counted as unknown rather than treated as zero. Signed and open pipeline
// stay separate; nothing is probability-weighted.

export const OPEN_STAGES: DealStage[] = ["lead", "pitched", "negotiating", "verbal"];

export interface CurrencyTotal { currency: string; minor: number; deals: number }
export interface Bucket { totals: CurrencyTotal[]; deals: number; unknownAmount: number }

function bucket(deals: SponsorDeal[]): Bucket {
  const byCurrency = new Map<string, CurrencyTotal>();
  let unknownAmount = 0;
  for (const d of deals) {
    if (d.amount_minor === null) { unknownAmount++; continue; }
    const t = byCurrency.get(d.currency) ?? { currency: d.currency, minor: 0, deals: 0 };
    t.minor = addMinor(t.minor, d.amount_minor);
    t.deals++;
    byCurrency.set(d.currency, t);
  }
  return { totals: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)), deals: deals.length, unknownAmount };
}

export function pipelineSummary(deals: SponsorDeal[], today: string) {
  const open = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  return {
    signed: bucket(deals.filter((d) => d.stage === "signed")),
    open: bucket(open),
    byStage: Object.fromEntries(OPEN_STAGES.map((s) => [s, bucket(open.filter((d) => d.stage === s))])) as Record<DealStage, Bucket>,
    overdueNextSteps: open.filter((d) => d.next_step_due && d.next_step_due < today).length,
    noNextStep: open.filter((d) => !d.next_step).length,
  };
}
