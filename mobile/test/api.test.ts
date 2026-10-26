import { describe, expect, it } from "vitest";
import { ApiError, createClient, normalizeServerUrl } from "../src/lib/api";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("mobile API client", () => {
  it("signs in as a mobile client and sends the bearer token afterwards", async () => {
    const { f, calls } = fakeFetch((url) => (url.endsWith("/login") ? { status: 200, body: { token: "tok", expiresAt: "x" } } : { status: 200, body: { shows: [] } }));
    let token: string | null = null;
    const c = createClient("http://server", () => token, f);
    const r = await c.login("a@example.com", "pw");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: "a@example.com", password: "pw", client: "mobile" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    token = r.token;
    await c.pulse("org 1");
    expect(calls[1]!.url).toBe("http://server/api/orgs/org%201/pulse");
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("surfaces server errors with status and action", async () => {
    const { f } = fakeFetch(() => ({ status: 502, body: { kind: "rate_limited", message: "HTTP 429", action: "Wait" } }));
    const err = await createClient("http://s", () => "t", f).refresh("o", "e").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.body.action).toBe("Wait");
  });

  it("explains unreachable servers", async () => {
    const f = (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch;
    const err = await createClient("http://10.0.0.5:8787", () => null, f).me().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the RevOS server at http:\/\/10\.0\.0\.5:8787/);
  });

  it("normalizes server addresses", () => {
    expect(normalizeServerUrl(" https://revos.example.com/ ")).toBe("https://revos.example.com");
    expect(() => normalizeServerUrl("revos.example.com")).toThrow();
  });
});
