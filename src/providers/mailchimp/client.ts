// Read-only Mailchimp Marketing API client (see docs/integrations.md).
// Base URL is per data center, taken from the API key suffix ("…-us21").

import { ProviderError } from "../errors.js";
import { BoundedHttp } from "../http.js";

export interface MailchimpClientOptions {
  apiKey: string;
  /** Override for tests/fixtures. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRequests?: number;
  maxPages?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function mailchimpBaseUrl(apiKey: string): string {
  const dash = apiKey.lastIndexOf("-");
  const dc = dash > 0 ? apiKey.slice(dash + 1) : "";
  if (!/^[a-z]{2,4}\d{1,3}$/.test(dc)) throw new ProviderError("not_configured", "Mailchimp API key has no data-center suffix (expected something like …-us21).");
  return `https://${dc}.api.mailchimp.com/3.0/`;
}

export class MailchimpClient {
  private readonly http: BoundedHttp;
  private readonly maxPages: number;

  constructor(opts: MailchimpClientOptions) {
    if (!opts.apiKey) throw new ProviderError("not_configured", "Mailchimp API key is not configured.");
    this.maxPages = opts.maxPages ?? 50;
    this.http = new BoundedHttp({
      baseUrl: opts.baseUrl ?? mailchimpBaseUrl(opts.apiKey),
      // HTTP Basic with any username and the API key as password.
      headers: { Authorization: `Basic ${Buffer.from(`revos:${opts.apiKey}`).toString("base64")}` },
      fetchImpl: opts.fetchImpl,
      maxRequests: opts.maxRequests ?? 300,
      maxRetries: opts.maxRetries,
      sleep: opts.sleep,
    });
  }

  get requestsMade(): number {
    return this.http.requestsMade;
  }

  get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    return this.http.get<T>(path, params);
  }

  /** count/offset pagination with total_items; errors instead of truncating at the page bound. */
  async listAll<T>(path: string, key: string, params: Record<string, string | undefined> = {}, pageSize = 100): Promise<T[]> {
    const items: T[] = [];
    for (let page = 0; ; page++) {
      if (page >= this.maxPages) throw new ProviderError("limit_exceeded", `Page bound of ${this.maxPages} reached for ${path}.`);
      const body = await this.http.get<Record<string, unknown>>(path, { ...params, count: String(pageSize), offset: String(page * pageSize) });
      const list = body[key];
      if (!Array.isArray(list)) throw new ProviderError("bad_response", `Expected '${key}' array in ${path}.`);
      items.push(...(list as T[]));
      const total = typeof body.total_items === "number" ? body.total_items : null;
      if (list.length < pageSize || (total !== null && items.length >= total)) break;
    }
    return items;
  }
}
