// Browser API client. Talks only to the RevOS server; never to vendor APIs.
import type {
  ConnectionsResponse, EventDetailResponse, EventsResponse, LoginResponse, MeResponse, PulseResponse, RefreshResponse, TargetRequest,
} from "../shared/apiTypes.js";

export type * from "../shared/apiTypes.js";

const TOKEN_KEY = "revos.session";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.message ?? body.error ?? `HTTP ${status}`));
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  login: (email: string, password: string) => call<LoginResponse>("/api/auth/login", json("POST", { email, password, client: "web" })),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => call<MeResponse>("/api/me"),
  pulse: (orgId: string) => call<PulseResponse>(`/api/orgs/${orgId}/pulse`),
  events: (orgId: string) => call<EventsResponse>(`/api/orgs/${orgId}/events`),
  event: (orgId: string, eventId: string) => call<EventDetailResponse>(`/api/orgs/${orgId}/events/${eventId}`),
  refresh: (orgId: string, eventId: string) => call<RefreshResponse>(`/api/orgs/${orgId}/events/${eventId}/refresh`, { method: "POST" }),
  setTarget: (orgId: string, eventId: string, t: TargetRequest) => call<{ ok: true }>(`/api/orgs/${orgId}/events/${eventId}/targets`, json("PUT", t)),
  deleteTarget: (orgId: string, eventId: string, measure: string) => call<{ ok: true }>(`/api/orgs/${orgId}/events/${eventId}/targets/${measure}`, { method: "DELETE" }),
  setTrackingLink: (orgId: string, code: string, label: string | null, channel: string | null) =>
    call<{ ok: true }>(`/api/orgs/${orgId}/tracking-links/${encodeURIComponent(code)}`, json("PUT", { label, channel })),
  setSpend: (orgId: string, eventId: string, code: string, currency: string, amountMinor: number | null) =>
    call<{ ok: true }>(`/api/orgs/${orgId}/events/${eventId}/marketing-spend/${encodeURIComponent(code)}`, json("PUT", { amountMinor, currency })),
  connections: (orgId: string) => call<ConnectionsResponse>(`/api/orgs/${orgId}/connections`),
  testConnection: (orgId: string, connectionId: string) =>
    call<{ ok: boolean; message: string }>(`/api/orgs/${orgId}/connections/${connectionId}/test`, { method: "POST" }),
};
