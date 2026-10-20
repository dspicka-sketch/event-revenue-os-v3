// Read-only Eventbrite API v3 client. Only GET requests are ever issued.
//
// Evidence for endpoints/semantics lives in docs/integrations.md. Anything
// marked UNVERIFIED there must be checked against official docs and a live
// authorized read before being relied on.

import { ProviderError } from "../errors.js";

export const EVENTBRITE_BASE_URL = "https://www.eventbriteapi.com/v3/";

export interface EventbriteClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Retries for 429 / 5xx / timeout / network on GET (all requests are GETs). */
  maxRetries?: number;
  /** Hard bound on pages per paginated listing. */
  maxPages?: number;
  /** Hard bound on total HTTP requests made by this client instance. */
  maxRequests?: number;
  /** Upper bound on any single backoff wait. */
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Pagination {
  object_count?: number;
  page_number?: number;
  page_size?: number;
  page_count?: number;
  continuation?: string;
  has_more_items?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class EventbriteClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxPages: number;
  private readonly maxRequests: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  requestsMade = 0;
  pagesFetched = 0;

  constructor(private readonly opts: EventbriteClientOptions) {
    if (!opts.token) throw new ProviderError("not_configured", "Eventbrite token is not configured.");
    this.baseUrl = opts.baseUrl ?? EVENTBRITE_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxPages = opts.maxPages ?? 200;
    this.maxRequests = opts.maxRequests ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      if (this.requestsMade >= this.maxRequests) {
        throw new ProviderError("limit_exceeded", `Request bound of ${this.maxRequests} reached.`);
      }
      this.requestsMade++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.opts.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new ProviderError(isTimeout ? "timeout" : "network", isTimeout ? `Timed out after ${this.timeoutMs} ms (${attempt + 1} attempts).` : `Network error after ${attempt + 1} attempts.`);
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new ProviderError("bad_response", `Non-JSON response from ${url.pathname}.`, res.status);
        }
      }

      const detail = await safeErrorDetail(res);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < this.maxRetries) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          await this.sleep(Math.min(retryAfter ?? this.backoff(attempt), this.maxBackoffMs));
          continue;
        }
        throw new ProviderError(res.status === 429 ? "rate_limited" : "server", `HTTP ${res.status} after ${attempt + 1} attempts${detail}.`, res.status);
      }
      if (res.status === 401) throw new ProviderError("auth", `HTTP 401${detail}.`, 401);
      if (res.status === 403) throw new ProviderError("forbidden", `HTTP 403${detail}.`, 403);
      if (res.status === 404) throw new ProviderError("not_found", `HTTP 404 for ${url.pathname}${detail}.`, 404);
      throw new ProviderError("bad_response", `HTTP ${res.status}${detail}.`, res.status);
    }
  }

  /**
   * Read every page of a paginated listing. Uses the `continuation` token when
   * supplied, otherwise `page` numbers. Stops at `maxPages` with an error rather
   * than returning a silently truncated list.
   */
  async listAll<T>(path: string, key: string, params: Record<string, string | undefined> = {}): Promise<T[]> {
    const items: T[] = [];
    let continuation: string | undefined;
    let page = 1;
    const seenContinuations = new Set<string>();
    for (let n = 0; ; n++) {
      if (n >= this.maxPages) throw new ProviderError("limit_exceeded", `Page bound of ${this.maxPages} reached for ${path}.`);
      const body = await this.get<Record<string, unknown>>(path, {
        ...params,
        ...(continuation ? { continuation } : n > 0 ? { page: String(page) } : {}),
      });
      this.pagesFetched++;
      const list = body[key];
      if (!Array.isArray(list)) throw new ProviderError("bad_response", `Expected '${key}' array in ${path}.`);
      items.push(...(list as T[]));
      const p = (body.pagination ?? {}) as Pagination;
      const more = p.has_more_items ?? (p.page_number !== undefined && p.page_count !== undefined && p.page_number < p.page_count);
      if (!more) break;
      if (p.continuation) {
        if (seenContinuations.has(p.continuation)) throw new ProviderError("bad_response", `Repeated continuation token for ${path}.`);
        seenContinuations.add(p.continuation);
        continuation = p.continuation;
      } else {
        continuation = undefined;
        page = (p.page_number ?? page) + 1;
      }
    }
    return items;
  }

  private backoff(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, this.maxBackoffMs);
  }
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Extract Eventbrite's error code without echoing anything sensitive. */
async function safeErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" && /^[A-Z_]{1,64}$/.test(body.error) ? ` (${body.error})` : "";
  } catch {
    return "";
  }
}
