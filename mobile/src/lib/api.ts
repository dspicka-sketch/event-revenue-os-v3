// Mobile API client: the same RevOS server endpoints and contract types as the
// desktop client (src/shared/apiTypes.ts). Never calls vendor APIs.
import type {
  ApiErrorBody, EventDetailResponse, LoginResponse, MeResponse, PulseResponse, RefreshResponse,
} from "@revos/shared/apiTypes";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Partial<ApiErrorBody> & Record<string, unknown>) {
    super(String(body.message ?? body.error ?? `HTTP ${status}`));
  }
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(trimmed)) throw new Error("Enter a server address starting with http:// or https://");
  return trimmed;
}

export interface Client {
  login(email: string, password: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<MeResponse>;
  pulse(orgId: string): Promise<PulseResponse>;
  event(orgId: string, eventId: string): Promise<EventDetailResponse>;
  refresh(orgId: string, eventId: string): Promise<RefreshResponse>;
}

export function createClient(baseUrl: string, getToken: () => string | null, fetchImpl: typeof fetch = fetch): Client {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiError(0, { error: "network", message: `Cannot reach the RevOS server at ${baseUrl}. Check the address and your connection.` });
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  }
  return {
    login: (email, password) => call<LoginResponse>("/api/auth/login", { method: "POST", body: { email, password, client: "mobile" } }),
    logout: async () => { await call("/api/auth/logout", { method: "POST" }); },
    me: () => call<MeResponse>("/api/me"),
    pulse: (orgId) => call<PulseResponse>(`/api/orgs/${encodeURIComponent(orgId)}/pulse`),
    event: (orgId, eventId) => call<EventDetailResponse>(`/api/orgs/${encodeURIComponent(orgId)}/events/${encodeURIComponent(eventId)}`),
    refresh: (orgId, eventId) => call<RefreshResponse>(`/api/orgs/${encodeURIComponent(orgId)}/events/${encodeURIComponent(eventId)}/refresh`, { method: "POST" }),
  };
}
