// Outbound email for AutoRev (D19). RevOS emails only an organization's own
// admins. The key lives in the server environment and never appears in an
// error, a log line or an API response.
// Evidence: docs/integrations.md → Resend.

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export class EmailError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = "EmailError";
  }
}

export function resendSender(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): EmailSender {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async send(msg) {
      if (msg.to.length === 0) throw new EmailError("No recipients.");
      let res: Response;
      try {
        res = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: opts.from, to: msg.to, subject: msg.subject, text: msg.text }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new EmailError("The email service could not be reached.");
      }
      const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
      if (!res.ok) throw new EmailError(`The email service answered HTTP ${res.status}${typeof body?.message === "string" ? `: ${body.message}` : "."}`, res.status);
      if (typeof body?.id !== "string") throw new EmailError("The email service accepted the request but returned no message id.", res.status);
      return { id: body.id };
    },
  };
}
