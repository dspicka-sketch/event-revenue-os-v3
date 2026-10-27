# Executive OS

An AI operating system dashboard with an executive assistant agent built on Claude.

**The assistant** (`lib/agent.ts`) is a Claude tool-use agent that can:
- **Triage email:** search and read Gmail, then sort each message as urgent / reply / fyi / ignore
- **Draft replies:** save reply drafts to Gmail threads. It cannot send anything; you review and send.
- **Track tasks:** create, update and close follow-ups, with due dates taken from your email
- **Manage the calendar:** read your schedule, find time and add events. Invites go to other people only when you explicitly ask.
- **Answer revenue questions from RevOS:** ticket sales, gross after refunds, weekly pace, targets and which marketing is driving sales. Read-only.
- **Write a daily briefing:** top priorities, today's schedule with prep notes, decisions needed, revenue (when RevOS is connected), due-soon items and inbox status. Runs on a weekday cron.

**The dashboard** (`app/page.tsx`) shows KPI tiles, today's schedule, the latest briefing, the priority inbox, tasks, a chat with the assistant and an agent activity feed.

## Run locally

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY at minimum
npm run dev                   # http://localhost:3000
```

With only `ANTHROPIC_API_KEY` set, the app runs in **demo mode**: an in-memory store with sample tasks and a sample inbox.

## Connect real data

**Supabase:** run `supabase/migrations/0001_init.sql` in your project, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is only used on the server.

**Gmail + Google Calendar:**
1. Create an OAuth client (Web app) in Google Cloud and enable the Gmail API and the Google Calendar API.
2. Get one refresh token with the scopes `gmail.readonly`, `gmail.compose` and `calendar.events`. The OAuth Playground with your own client is the easiest way.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`, plus `EXEC_TIMEZONE` (e.g. `America/New_York`) so the assistant schedules in your time zone.

**RevOS:** create a viewer account for the assistant (`npm run user -- create` and `grant` in the repo root), then set `REVOS_URL`, `REVOS_EMAIL`, `REVOS_PASSWORD` and optionally `REVOS_ORG_ID`. Executive OS imports RevOS's API types and money formatting from `../src`, so keep it inside this repo.

## Deploy (Vercel)

Set the env vars, including `APP_SECRET` (the dashboard is then protected by basic auth with that password) and `CRON_SECRET`. `vercel.json` runs the briefing at 12:30 UTC, Monday to Friday.

## Architecture

| Path | Role |
|---|---|
| `lib/agent.ts` | System prompt, tools and the Claude tool runner (`claude-opus-5-5`, server-side refusal fallback) |
| `lib/google.ts` | Shared Google OAuth token refresh |
| `lib/gmail.ts` | Gmail REST client, with a sample inbox as fallback |
| `lib/calendar.ts` | Google Calendar client, with a sample schedule as fallback |
| `lib/revos.ts` | Read-only RevOS API client (bearer session, re-signs-in on expiry) |
| `lib/store.ts` | Supabase store, with an in-memory demo store as fallback |
| `app/api/*` | `agent` (chat), `triage`, `briefing` (cron + button), `tasks`, `dashboard` |
| `proxy.ts` | Basic auth when `APP_SECRET` is set |

## Next modules
Sponsor pipeline tracking (RevOS covers tickets, not sponsorships).
