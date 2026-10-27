import { describe, expect, it } from "vitest";
import { MailchimpAdapter } from "../src/providers/mailchimp/adapter.js";
import { mailchimpBaseUrl } from "../src/providers/mailchimp/client.js";
import { createMailchimpFixtureTransport, FIXTURE_MC_ACCOUNT_ID, mailchimpFixture } from "../src/providers/mailchimp/fixtures.js";
import { parseEventbriteLink } from "../src/providers/mailchimp/normalize.js";
import { ProviderError } from "../src/providers/errors.js";

const NOW = () => new Date("2026-10-20T19:00:00Z");
function adapter(t = createMailchimpFixtureTransport(), extra: Record<string, unknown> = {}) {
  return new MailchimpAdapter({ apiKey: "key-us21", baseUrl: "https://us21.api.mailchimp.com/3.0/", accountId: FIXTURE_MC_ACCOUNT_ID, fetchImpl: t.fetch, sleep: async () => {}, ...extra }, NOW);
}

describe("Mailchimp connector", () => {
  it("derives the data-center base URL from the key", () => {
    expect(mailchimpBaseUrl("abc123-us21")).toBe("https://us21.api.mailchimp.com/3.0/");
    expect(() => mailchimpBaseUrl("abc123")).toThrow(ProviderError);
  });

  it("parses Eventbrite links and their tracking codes", () => {
    expect(parseEventbriteLink("https://www.eventbrite.com/e/some-show-tickets-123456789012?aff=mc-oct")).toEqual({ sourceEventId: "123456789012", trackingCode: "mc-oct" });
    expect(parseEventbriteLink("https://www.eventbrite.co.uk/e/123456789012")).toEqual({ sourceEventId: "123456789012", trackingCode: null });
    expect(parseEventbriteLink("https://venue.example.com/e/123")).toBeNull();
    expect(parseEventbriteLink("not a url")).toBeNull();
  });

  it("reads campaigns with paginated reports and keeps only links to Eventbrite events", async () => {
    const t = createMailchimpFixtureTransport();
    const { campaigns } = await adapter(t).fetchCampaigns();
    expect(campaigns).toHaveLength(4);
    const announce = campaigns.find((c) => c.title === "On sale now: The Night Owls")!;
    expect(announce).toMatchObject({ emailsSent: 4800, uniqueOpens: 2140, sentAt: "2026-09-02T17:00:00.000Z" });
    expect(announce.eventLinks).toEqual([
      { provider: "eventbrite", sourceEventId: "fx-1001", trackingCode: "mc-announce", uniqueClicks: 310, totalClicks: 403 },
      { provider: "eventbrite", sourceEventId: "fx-1002", trackingCode: "mc-announce", uniqueClicks: 120, totalClicks: 156 },
    ]);
    expect(campaigns.find((c) => c.title.startsWith("Venue newsletter"))!.eventLinks.map((l) => l.sourceEventId)).toEqual(["123456789012"]);
    expect(t.calls.every((c) => !/members|email-activity|lists/.test(c))).toBe(true); // never subscriber-level data
  });

  it("errors at the page bound instead of truncating", async () => {
    const data = mailchimpFixture();
    const t = createMailchimpFixtureTransport(data);
    const a = new MailchimpAdapter({ apiKey: "k-us21", baseUrl: "https://us21.api.mailchimp.com/3.0/", accountId: FIXTURE_MC_ACCOUNT_ID, fetchImpl: t.fetch, maxPages: 1 }, NOW);
    // 4 reports fit in one page of 100, so lower the bound via many reports instead.
    data.reports.push(...Array.from({ length: 150 }, (_, i) => ({ id: `x${i}`, send_time: "2026-10-01T00:00:00Z" })));
    await expect(a.fetchCampaigns()).rejects.toMatchObject({ kind: "limit_exceeded" });
  });

  it("refuses a key from a different Mailchimp account", async () => {
    await expect(adapter(createMailchimpFixtureTransport(), { accountId: "someone-else" }).fetchCampaigns()).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("classifies auth failures", async () => {
    const t = createMailchimpFixtureTransport(undefined, { failFor: () => ({ status: 401 }) });
    await expect(adapter(t).fetchCampaigns()).rejects.toMatchObject({ kind: "auth" });
  });
});
