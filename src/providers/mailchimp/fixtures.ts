// Synthetic Mailchimp account for FIXTURE MODE and tests: campaign-level
// aggregates only (no subscribers). Campaign links carry the same tracking
// codes as the Eventbrite fixture tickets.

import { FIXTURE_CAMPAIGNS } from "../eventbrite/fixtures.js";
import type { McClickedUrl, McReport } from "./normalize.js";

export const FIXTURE_MC_ACCOUNT_ID = "fixture-mc-1";

const ev = (id: string, code: string) => `https://www.eventbrite.com/e/the-night-owls-live-tickets-${id}?aff=${code}`;

const CLICKS: Record<string, [number, number]> = {
  "mc-announce": [310, 120],
  "mc-lineup": [190, 85],
  "mc-lastcall": [260, 140],
};

export function mailchimpFixture(): { reports: McReport[]; clicks: Record<string, McClickedUrl[]> } {
  const reports: McReport[] = FIXTURE_CAMPAIGNS.map((c, i) => ({
    id: `mc-c${i + 1}`,
    campaign_title: c.title,
    subject_line: c.title,
    emails_sent: 4800 + i * 150,
    send_time: c.sendTime,
    opens: { unique_opens: [2140, 1890, 2310][i]! },
  }));
  const clicks: Record<string, McClickedUrl[]> = {};
  FIXTURE_CAMPAIGNS.forEach((c, i) => {
    const [n1, n2] = CLICKS[c.code]!;
    clicks[`mc-c${i + 1}`] = [
      { url: ev("fx-1001", c.code), total_clicks: Math.round(n1 * 1.3), unique_clicks: n1 },
      { url: ev("fx-1002", c.code), total_clicks: Math.round(n2 * 1.3), unique_clicks: n2 },
      { url: "https://venue.example.com/calendar", total_clicks: 75, unique_clicks: 60 },
    ];
  });
  // A newsletter that links to no show, and one link to an event this org doesn't map.
  reports.push({ id: "mc-c4", campaign_title: "Venue newsletter: October", emails_sent: 5200, send_time: "2026-10-01T16:00:00Z", opens: { unique_opens: 2400 } });
  clicks["mc-c4"] = [
    { url: "https://venue.example.com/", total_clicks: 210, unique_clicks: 180 },
    { url: "https://www.eventbrite.com/e/another-show-tickets-123456789012?aff=mc-oct", total_clicks: 40, unique_clicks: 33 },
  ];
  return { reports, clicks };
}

export function createMailchimpFixtureTransport(data = mailchimpFixture(), opts: { failFor?: (path: string) => { status: number } | undefined } = {}) {
  const calls: string[] = [];
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const page = (key: string, items: unknown[], q: URLSearchParams) => {
    const count = Number(q.get("count") ?? 10);
    const offset = Number(q.get("offset") ?? 0);
    return { [key]: items.slice(offset, offset + count), total_items: items.length };
  };
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.method ?? "GET") !== "GET") throw new Error("Fixture transport: only GET is allowed");
    const path = url.pathname.replace(/^\/3\.0\/?/, "");
    calls.push(path + url.search);
    const fail = opts.failFor?.(path);
    if (fail) return respond(fail.status, { title: "Fixture Error", status: fail.status });
    if (!new Headers(init?.headers).get("authorization")?.startsWith("Basic ")) return respond(401, { title: "API Key Missing" });
    if (path === "") return respond(200, { account_id: FIXTURE_MC_ACCOUNT_ID, account_name: "Fixture Venue" });
    if (path === "ping") return respond(200, { health_status: "Everything's Chimpy!" });
    if (path === "reports") {
      const since = url.searchParams.get("since_send_time");
      const rs = data.reports.filter((r) => !since || !r.send_time || r.send_time >= since);
      return respond(200, page("reports", rs, url.searchParams));
    }
    const m = path.match(/^reports\/([^/]+)\/click-details$/);
    if (m) return respond(200, page("urls_clicked", data.clicks[decodeURIComponent(m[1]!)] ?? [], url.searchParams));
    return respond(404, { title: "Resource Not Found" });
  };
  return { fetch: impl as typeof fetch, calls };
}
