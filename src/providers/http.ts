// Bounded, read-only HTTP for vendor adapters. Only GET is ever issued.
// Retries 429/5xx/timeout/network a bounded number of times (honoring
// Retry-After), never retries 401/403/404, and caps total requests per instance.

import { ProviderError } from "./errors.js";

export interface BoundedHttpOptions {
  baseUrl: string;
  /** Auth and other fixed headers. Never logged or echoed. */
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  maxRequests?: number;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BoundedHttp {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRequests: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  requestsMade = 0;

  constructor(private readonly opts: BoundedHttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxRequests = opts.maxRequests ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.opts.baseUrl);
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
          headers: { ...this.opts.headers, Accept: "application/json" },
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

/** A vendor error code or short title, never the raw body (which may echo input). */
async function safeErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; title?: unknown };
    if (typeof body.error === "string" && /^[A-Z_]{1,64}$/.test(body.error)) return ` (${body.error})`;
    if (typeof body.title === "string" && /^[A-Za-z ]{1,64}$/.test(body.title)) return ` (${body.title})`;
    return "";
  } catch {
    return "";
  }
}
