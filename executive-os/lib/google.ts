// Shared Google OAuth (refresh-token flow) for Gmail and Calendar.
// The refresh token needs scopes: gmail.readonly, gmail.compose, calendar.events.

export const googleConfigured = () =>
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

export async function googleFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`Google API ${url} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
