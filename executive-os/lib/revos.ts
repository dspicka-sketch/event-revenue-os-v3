import type { EventDetailResponse, LoginResponse, MeResponse, PulseResponse } from "../../src/shared/apiTypes";

// Read-only client for the RevOS API (../src/server). Signs in as a RevOS user
// (ideally a viewer-role account made for the assistant) and keeps the bearer
// session, signing in again when it expires. Never calls write endpoints.

export const revosConfigured = () =>
  Boolean(process.env.REVOS_URL && process.env.REVOS_EMAIL && process.env.REVOS_PASSWORD);

let session: { token: string; expires: number } | undefined;
let orgId: string | undefined = process.env.REVOS_ORG_ID || undefined;

async function login(): Promise<string> {
  const res = await fetch(`${process.env.REVOS_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.REVOS_EMAIL, password: process.env.REVOS_PASSWORD, client: "web" }),
  });
  if (!res.ok) throw new Error(`RevOS sign-in failed: ${res.status}`);
  const j = (await res.json()) as LoginResponse;
  session = { token: j.token, expires: Date.parse(j.expiresAt) };
  return j.token;
}

async function revos<T>(path: string, retry = true): Promise<T> {
  const token = session && session.expires > Date.now() + 60_000 ? session.token : await login();
  const res = await fetch(`${process.env.REVOS_URL}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    session = undefined;
    return revos<T>(path, false);
  }
  if (!res.ok) throw new Error(`RevOS ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function org(): Promise<string> {
  if (orgId) return orgId;
  const me = await revos<MeResponse>("/api/me");
  const first = me.organizations[0];
  if (!first) throw new Error("The RevOS user is not a member of any organization");
  return (orgId = first.id);
}

export async function getPulse(): Promise<PulseResponse> {
  return revos<PulseResponse>(`/api/orgs/${await org()}/pulse`);
}

export async function getShow(eventId: string): Promise<EventDetailResponse> {
  return revos<EventDetailResponse>(`/api/orgs/${await org()}/events/${encodeURIComponent(eventId)}`);
}

// Compact view of the pulse for the agent: the full payload carries 14-day
// pace series and driver tables it rarely needs.
export function summarizePulse(p: PulseResponse) {
  return {
    organization: p.organization.name,
    isFixtureData: p.organization.is_fixture,
    generatedAt: p.generatedAt,
    summary: p.summary,
    whatsWorkingLast7Days: p.marketingLast7Days,
    shows: p.shows.map((s) => ({
      id: s.id, name: s.name, performanceStartUtc: s.performanceStartUtc, venueTimezone: s.venueTimezone,
      phase: s.phase, daysUntil: s.daysUntil, currency: s.currency, tickets: s.tickets,
      grossAfterRefunds: s.revenue?.grossAfterRefunds ?? null,
      last7DaysPaidTickets: s.pace?.last7DaysPaidTickets ?? null,
      previous7DaysPaidTickets: s.pace?.previous7DaysPaidTickets ?? null,
      targets: s.targets,
      topDrivers: s.marketing?.topDrivers ?? [],
      stale: s.freshness.stale, dataAsOf: s.freshness.dataAsOf,
      attention: s.attention.map((a) => `${a.severity}: ${a.title} (${a.detail})`),
    })),
  };
}
