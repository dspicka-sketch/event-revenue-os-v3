// Read-only Eventbrite API v3 client. Only GET requests are ever issued.
//
// Evidence for endpoints/semantics lives in docs/integrations.md. Anything
// marked UNVERIFIED there must be checked against official docs and a live
// authorized read before being relied on.

import { ProviderError } from "../errors.js";
import { BoundedHttp } from "../http.js";

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

export class EventbriteClient {
  private readonly http: BoundedHttp;
  private readonly maxPages: number;
  pagesFetched = 0;

  constructor(opts: EventbriteClientOptions) {
    if (!opts.token) throw new ProviderError("not_configured", "Eventbrite token is not configured.");
    this.maxPages = opts.maxPages ?? 200;
    this.http = new BoundedHttp({
      baseUrl: opts.baseUrl ?? EVENTBRITE_BASE_URL,
      headers: { Authorization: `Bearer ${opts.token}` },
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      maxRequests: opts.maxRequests,
      maxBackoffMs: opts.maxBackoffMs,
      sleep: opts.sleep,
    });
  }

  get requestsMade(): number {
    return this.http.requestsMade;
  }

  get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    return this.http.get<T>(path, params);
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

}
