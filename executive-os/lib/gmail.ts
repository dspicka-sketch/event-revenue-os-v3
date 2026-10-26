import type { EmailMessage } from "./types";

// Gmail access via OAuth refresh token. Falls back to a sample inbox when not configured.
// Scopes needed: gmail.readonly + gmail.compose (drafts only; the agent never sends).

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const gmailConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

let token: { value: string; expires: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function gmail<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`Gmail ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload: GmailPart;
}

const b64decode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function textBody(p: GmailPart): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64decode(p.body.data);
  for (const c of p.parts ?? []) {
    const t = textBody(c);
    if (t) return t;
  }
  return "";
}

function toMessage(m: GmailMessage, withBody: boolean): EmailMessage {
  const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  return {
    id: m.id, threadId: m.threadId, from: h("From"), to: h("To"), subject: h("Subject"),
    date: h("Date"), snippet: m.snippet, messageIdHeader: h("Message-ID"),
    body: withBody ? textBody(m.payload).slice(0, 20_000) : undefined,
  };
}

export async function searchEmail(query: string, max = 15): Promise<EmailMessage[]> {
  if (!gmailConfigured()) return SAMPLE_INBOX.slice(0, max);
  const list = await gmail<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  return Promise.all(
    (list.messages ?? []).map(async ({ id }) =>
      toMessage(await gmail<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`), false),
    ),
  );
}

export async function getEmail(id: string): Promise<EmailMessage> {
  if (!gmailConfigured()) {
    const m = SAMPLE_INBOX.find((x) => x.id === id);
    if (!m) throw new Error(`Message ${id} not found`);
    return m;
  }
  return toMessage(await gmail<GmailMessage>(`/messages/${id}?format=full`), true);
}

export async function createReplyDraft(messageId: string, body: string): Promise<string> {
  const original = await getEmail(messageId);
  if (!gmailConfigured()) return `demo-draft-${messageId}`;
  const subject = original.subject.toLowerCase().startsWith("re:") ? original.subject : `Re: ${original.subject}`;
  const raw = [
    `To: ${original.from}`,
    `Subject: ${subject}`,
    ...(original.messageIdHeader ? [`In-Reply-To: ${original.messageIdHeader}`, `References: ${original.messageIdHeader}`] : []),
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const draft = await gmail<{ id: string }>("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { threadId: original.threadId, raw: Buffer.from(raw).toString("base64url") } }),
  });
  return draft.id;
}

const ago = (h: number) => new Date(Date.now() - h * 36e5).toUTCString();
const SAMPLE_INBOX: EmailMessage[] = [
  { id: "s1", threadId: "t1", from: "Priya Shah <priya@acmecorp.example.com>", to: "you", subject: "Sponsorship tiers for Spring Summit",
    date: ago(2), snippet: "Can you send the updated platinum/gold pricing by Friday? Our budget closes next week.",
    body: "Hi,\n\nCan you send the updated platinum/gold pricing by Friday? Our budget closes next week and I'd like to get the Summit in before then. Also, is the speaking slot still included at platinum?\n\nThanks,\nPriya" },
  { id: "s2", threadId: "t2", from: "Marcus Lee <marcus@grandhallvenues.example.com>", to: "you", subject: "Deposit due — Spring Summit hold expires Wednesday",
    date: ago(5), snippet: "Friendly reminder the 30% deposit is due by Wednesday to keep the date hold.",
    body: "Hi,\n\nFriendly reminder the 30% deposit ($18,000) is due by Wednesday to keep the March 14-15 hold. After that we'll release the date to another client.\n\nBest,\nMarcus" },
  { id: "s3", threadId: "t3", from: "Jordan Kim <jordan@tixflow.example.com>", to: "you", subject: "Re: ticketing integration",
    date: ago(20), snippet: "We pushed the webhook fix. Can you confirm sales are syncing on your side?",
    body: "We pushed the webhook fix last night. Can you confirm sales are syncing on your side? If so we can close this out.\n\nJordan" },
  { id: "s4", threadId: "t4", from: "Event Weekly <news@eventweekly.example.com>", to: "you", subject: "This week in events: 5 trends for 2027",
    date: ago(26), snippet: "Hybrid is back, sponsorship ROI reporting, and more.", body: "Newsletter content." },
  { id: "s5", threadId: "t5", from: "Alex Rivera <alex@yourco.example.com>", to: "you", subject: "Board update draft — need your numbers",
    date: ago(30), snippet: "Can you drop Q3 event revenue and pipeline into the board doc by Thursday?",
    body: "Hey — can you drop Q3 event revenue and the Q4 sponsor pipeline into the board doc by Thursday EOD? Rest is ready.\n\nAlex" },
];
