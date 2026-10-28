import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError, BlockedReason, FinishReason, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { AiError, createTextGeneratorFromEnv, DEFAULT_GEMINI_MODEL, GeminiTextGenerator, type GeminiClientLike } from "../src/ai/gemini.js";
import { buildInsightPrompt, INSIGHT_SYSTEM } from "../src/ai/insightPrompt.js";
import { computeMarketing, type CampaignRef } from "../src/domain/marketing.js";
import { buildShowCard, type ShowInput } from "../src/domain/pulse.js";
import { computeEventRevenue } from "../src/domain/revenue.js";
import { normalizeAttendee, normalizeOrder } from "../src/providers/eventbrite/normalize.js";
import { attendees, costs, order } from "./helpers/build.js";

const NOW = new Date("2026-10-20T19:00:00Z");
const TZ = "America/Los_Angeles";

function fixtureShow() {
  const lc = (n: number) => Array.from({ length: n }, () => costs(2500, 271, 80, 0));
  const sales = [
    { id: "o1", created: "2026-10-18T20:00:00Z", qty: 2, aff: "mc-announce", email: "buyer.one@example.com" },
    { id: "o2", created: "2026-10-19T20:00:00Z", qty: 1, aff: "ig-bio", email: "buyer.two@example.com" },
    { id: "o3", created: "2026-10-01T20:00:00Z", qty: 3, aff: null, email: "buyer.three@example.com" },
  ];
  const orders = sales.map((s) => normalizeOrder(order(s.id, "e1", lc(s.qty), { created: s.created }), "USD"));
  const lines = sales.flatMap((s) => attendees(s.id, "e1", lc(s.qty), Array(s.qty).fill({ affiliate: s.aff, profile: { email: s.email, name: "Buyer" } })).map((a) => normalizeAttendee(a, "USD")));
  const campaigns: CampaignRef[] = [{
    id: "c1", source: "mailchimp", title: "On sale now", sentAt: "2026-10-17T17:00:00Z", trackingCodes: ["mc-announce"], emailsSent: 5000, uniqueOpens: 2100, eventLinkClicks: 40,
  }];
  const links = { "ig-bio": { label: "Instagram bio", channel: "social" as const } };
  const spend = { "ig-bio": [{ currency: "USD", minor: 12000 }] };
  const marketing = computeMarketing(orders, lines, campaigns, { links, spend });
  const marketing7 = computeMarketing(orders, lines, campaigns, { links, since: new Date(NOW.getTime() - 7 * 86400_000) });
  const input: ShowInput = {
    id: "e1", name: "Night 1", performanceStartUtc: "2026-10-31T03:00:00Z", venueTimezone: TZ, provider: "eventbrite", mode: "fixture",
    connectionStatus: "fixture", connectionStatusKind: null, connectionAction: null, stale: false, dataAsOf: "2026-10-20T18:00:00Z",
    revenue: computeEventRevenue(orders, lines, { proceedsPolicy: "unverified", asOf: NOW, timeZone: TZ }),
    reportComparison: null, targets: [{ measure: "paidTickets", value: 100, currency: null, source: "manual", updatedAt: null }],
    marketing, marketingLast7Days: marketing7,
  };
  return { card: buildShowCard(input, NOW), marketing, marketing7 };
}

describe("buildInsightPrompt", () => {
  it("gives the model the computed figures, formatted money and the attribution rows", () => {
    const { card, marketing, marketing7 } = fixtureShow();
    const p = buildInsightPrompt(card, marketing, marketing7);
    expect(p.system).toBe(INSIGHT_SYSTEM);
    expect(p.prompt.startsWith(p.basis)).toBe(true);
    expect(p.basis).toContain("Show: Night 1");
    expect(p.basis).toContain("FIXTURE DATA");
    expect(p.basis).toContain("Tickets: 6 paid, 0 comp, 0 refunded.");
    expect(p.basis).toContain("Gross after refunds (before fees): $171.06.");
    expect(p.basis).toContain("Organizer proceeds: Unavailable.");
    expect(p.basis).toContain("Pace: 3 paid tickets in the last 7 days ($85.53), 0 in the 7 days before that.");
    expect(p.basis).toContain("- Paid tickets: target 100, actual 6 (6%), status behind");
    expect(p.basis).toContain("Marketing, all sales to date: 50% of 6 paid tickets (3 orders) are linked to a marketing source.");
    expect(p.basis).toContain("- On sale now (email campaign): 2 paid tickets (33% of the show), 1 orders, gross after refunds $57.02, 2.5 linked orders per 100 clicks");
    expect(p.basis).toContain("- Instagram bio (tracking link, channel Social): 1 paid tickets (16% of the show), 1 orders, gross after refunds $28.51, spend entered $120.00, cost per paid ticket $120.00");
    expect(p.basis).toContain("- Unattributed (no tracking code): 3 paid tickets, 1 orders.");
    expect(p.basis).toContain("Marketing, orders placed in the last 7 days: 100% of 3 paid tickets");
    expect(p.basis).toContain("Items RevOS flags for attention:");
  });

  it("never includes patron data or record identifiers", () => {
    const { card, marketing, marketing7 } = fixtureShow();
    const { prompt, system } = buildInsightPrompt(card, marketing, marketing7);
    const text = `${system}\n${prompt}`;
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/buyer/i);
    expect(text).not.toMatch(/\bo[123]\b/);
    expect(text).not.toMatch(/barcode|email address|phone/i);
  });

  it("states that nothing has been read when there is no data", () => {
    const { card } = fixtureShow();
    const empty = { ...card, tickets: null, revenue: null, pace: null, targets: [], attention: [], freshness: { ...card.freshness, dataAsOf: null } };
    const p = buildInsightPrompt(empty, null, null);
    expect(p.basis).toContain("Data as of: never read");
    expect(p.basis).toContain("Tickets: no data read yet.");
    expect(p.basis).toContain("Marketing, all sales to date: no sales data yet.");
  });

  it("tells the model the rules it must keep", () => {
    expect(INSIGHT_SYSTEM).toMatch(/Never compute new numbers/);
    expect(INSIGHT_SYSTEM).toMatch(/Opens, clicks, list size or timing never mean a sale/);
    expect(INSIGHT_SYSTEM).toMatch(/Unavailable is unknown, not zero/);
  });
});

function fakeClient(answer: Partial<GenerateContentResponse> | Error, seen: GenerateContentParameters[] = []): GeminiClientLike {
  return {
    models: {
      async generateContent(params) {
        seen.push(params);
        if (answer instanceof Error) throw answer;
        return answer as GenerateContentResponse;
      },
    },
  };
}

const textResponse = (text: string, extra: Partial<GenerateContentResponse> = {}): Partial<GenerateContentResponse> =>
  ({ get text() { return text; }, candidates: [{ finishReason: FinishReason.STOP }], ...extra });

describe("GeminiTextGenerator", () => {
  it("sends the system instruction and prompt to the configured model and returns the text", async () => {
    const seen: GenerateContentParameters[] = [];
    const g = new GeminiTextGenerator({ apiKey: "k", model: "gemini-test", client: fakeClient(textResponse("  Two sentences. \n", { modelVersion: "gemini-test-001" }), seen) });
    const out = await g.generate({ system: "Rules.", prompt: "Figures." });
    expect(out).toEqual({ text: "Two sentences.", model: "gemini-test-001" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: "gemini-test", contents: "Figures.", config: { systemInstruction: "Rules.", maxOutputTokens: 400, candidateCount: 1 } });
  });

  it("maps a blocked prompt, an empty answer and a truncated answer to typed errors", async () => {
    const run = (r: Partial<GenerateContentResponse>) => new GeminiTextGenerator({ apiKey: "k", client: fakeClient(r) }).generate({ system: "s", prompt: "p" });
    await expect(run({ promptFeedback: { blockReason: BlockedReason.SAFETY }, get text() { return undefined; } })).rejects.toMatchObject({ kind: "blocked" });
    await expect(run({ candidates: [{ finishReason: FinishReason.MAX_TOKENS }], get text() { return ""; } })).rejects.toMatchObject({ kind: "truncated" });
    await expect(run({ candidates: [{ finishReason: FinishReason.STOP }], get text() { return undefined; } })).rejects.toMatchObject({ kind: "empty" });
  });

  it("maps provider HTTP errors without leaking the key", async () => {
    const run = async (e: Error): Promise<AiError> => {
      try { await new GeminiTextGenerator({ apiKey: "secret-key-value", client: fakeClient(e) }).generate({ system: "s", prompt: "p" }); }
      catch (err) { if (err instanceof AiError) return err; throw err; }
      throw new Error("expected a failure");
    };
    expect((await run(new ApiError({ status: 429, message: "quota" }))).kind).toBe("rate_limited");
    expect((await run(new ApiError({ status: 403, message: "bad key" }))).kind).toBe("auth");
    expect((await run(new ApiError({ status: 400, message: "API key not valid. Please pass a valid API key." }))).kind).toBe("auth");
    expect((await run(new ApiError({ status: 400, message: "Invalid argument" }))).kind).toBe("upstream");
    expect((await run(new ApiError({ status: 503, message: "busy" }))).kind).toBe("upstream");
    expect((await run(Object.assign(new Error("aborted"), { name: "AbortError" }))).kind).toBe("timeout");
    const net = await run(new Error("ECONNREFUSED"));
    expect(net.kind).toBe("network");
    expect(net.message).not.toContain("secret-key-value");
  });

  it("is absent without GEMINI_API_KEY and takes the model from GEMINI_MODEL", () => {
    expect(createTextGeneratorFromEnv({})).toBeNull();
    expect(createTextGeneratorFromEnv({ GEMINI_API_KEY: "  " })).toBeNull();
    const g = createTextGeneratorFromEnv({ GEMINI_API_KEY: "k" });
    expect(g).toMatchObject({ provider: "gemini", model: DEFAULT_GEMINI_MODEL });
    expect(createTextGeneratorFromEnv({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-2.5-flash" })?.model).toBe("gemini-2.5-flash");
    expect(() => new GeminiTextGenerator({ apiKey: "" })).toThrow(AiError);
  });
});

describe("dependency boundary", () => {
  it("imports @google/genai only under src/ai/ (never clients, shared types or domain)", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "mobile/src", "api", "scripts"], { encoding: "utf8" })
      .split("\n").filter((f) => f && existsSync(f));
    const offenders = files.filter((f) => !f.startsWith("src/ai/") && readFileSync(f, "utf8").includes("@google/genai"));
    expect(files.some((f) => f.startsWith("src/ai/"))).toBe(true);
    expect(offenders).toEqual([]);
  });
});
