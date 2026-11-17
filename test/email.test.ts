import { describe, expect, it } from "vitest";
import { EmailError, resendSender } from "../src/notify/email.js";

function fake(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const msg = { to: ["admin@example.com"], subject: "Weekly digest", text: "Hello" };

describe("Resend email sender", () => {
  it("posts the message with the bearer key and returns the id", async () => {
    const { fetchImpl, calls } = fake(200, { id: "em_123" });
    const out = await resendSender({ apiKey: "re_test_key", from: "RevOS <digest@example.com>", fetchImpl }).send(msg);
    expect(out).toEqual({ id: "em_123" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "RevOS <digest@example.com>", to: ["admin@example.com"], subject: "Weekly digest", text: "Hello" });
  });

  it("throws EmailError with the status on a 422 and never includes the key", async () => {
    const { fetchImpl } = fake(422, { message: "The from address is not verified." });
    const err = await resendSender({ apiKey: "re_test_key", from: "x@example.com", fetchImpl }).send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(EmailError);
    expect(err.httpStatus).toBe(422);
    expect(err.message).toContain("not verified");
    expect(err.message).not.toContain("re_test_key");
  });

  it("throws EmailError when a 200 answer has no id", async () => {
    const { fetchImpl } = fake(200, {});
    await expect(resendSender({ apiKey: "k", from: "x@example.com", fetchImpl }).send(msg)).rejects.toBeInstanceOf(EmailError);
  });

  it("refuses to send to nobody", async () => {
    const { fetchImpl, calls } = fake(200, { id: "x" });
    await expect(resendSender({ apiKey: "k", from: "x@example.com", fetchImpl }).send({ ...msg, to: [] })).rejects.toBeInstanceOf(EmailError);
    expect(calls).toHaveLength(0);
  });
});
