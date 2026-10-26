# Executive OS

An AI operating system dashboard with an executive assistant agent built on Claude.

**The assistant** (`lib/agent.ts`) is a Claude tool-use agent that can:
- **Triage email:** search and read Gmail, then sort each message as urgent / reply / fyi / ignore
- **Draft replies:** save reply drafts to Gmail threads. It cannot send anything; you review and send.
- **Track tasks:** create, update and close follow-ups, with due dates taken from your email
- **Write a daily briefing:** top priorities, decisions needed, due-soon items and inbox status. Runs on a weekday cron.

**The dashboard** (`app/page.tsx`) shows KPI tiles, the latest briefing, the priority inbox, tasks, a chat with the assistant and an agent activity feed.

## Run locally

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY at minimum
npm run dev                   # http://localhost:3000
```

With only `ANTHROPIC_API_KEY` set, the app runs in **demo mode**: an in-memory store with sample tasks and a sample inbox.

## Connect real data

**Supabase:** run `supabase/migrations/0001_init.sql` in your project, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is only used on the server.

**Gmail:**
1. Create an OAuth client (Web app) in Google Cloud and enable the Gmail API.
2. Get a refresh token with the scopes `gmail.readonly` and `gmail.compose`. The OAuth Playground with your own client is the easiest way.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`.

## Deploy (Vercel)

Set the env vars, including `APP_SECRET` (the dashboard is then protected by basic auth with that password) and `CRON_SECRET`. `vercel.json` runs the briefing at 12:30 UTC, Monday to Friday.

## Architecture

| Path | Role |
|---|---|
| `lib/agent.ts` | System prompt, tools and the Claude tool runner (`claude-opus-5-5`, server-side refusal fallback) |
| `lib/gmail.ts` | Gmail REST client, with a sample inbox as fallback |
| `lib/store.ts` | Supabase store, with an in-memory demo store as fallback |
| `app/api/*` | `agent` (chat), `triage`, `briefing` (cron + button), `tasks`, `dashboard` |
| `proxy.ts` | Basic auth when `APP_SECRET` is set |

## Next modules
Calendar (Google Calendar tools), and event revenue tracking (ticket/sponsor pipeline tiles) for Event Revenue OS.
