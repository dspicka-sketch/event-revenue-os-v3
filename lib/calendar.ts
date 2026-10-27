import { googleConfigured, googleFetch } from "./google";
import type { CalendarEvent } from "./types";

// Google Calendar (primary calendar). Falls back to a sample schedule when not configured.

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface GEvent {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { email: string; self?: boolean; responseStatus?: string }[];
}

const toEvent = (e: GEvent): CalendarEvent => ({
  id: e.id,
  title: e.summary ?? "(no title)",
  start: e.start.dateTime ?? e.start.date!,
  end: e.end.dateTime ?? e.end.date!,
  allDay: !e.start.dateTime,
  location: e.location,
  attendees: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.email),
  link: e.htmlLink,
});

export async function listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  if (!googleConfigured()) return sampleEvents(from, to);
  const q = new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(),
    singleEvents: "true", orderBy: "startTime", maxResults: "100",
  });
  const res = await googleFetch<{ items?: GEvent[] }>(`${API}?${q}`);
  return (res.items ?? []).map(toEvent);
}

export async function createEvent(e: {
  title: string; start: string; end: string; description?: string; location?: string;
  attendees?: string[]; sendInvites?: boolean;
}): Promise<CalendarEvent> {
  if (!googleConfigured()) {
    const ev: CalendarEvent = { id: `demo-${crypto.randomUUID()}`, title: e.title, start: e.start, end: e.end, allDay: false, location: e.location, attendees: e.attendees ?? [] };
    demoCreated.push(ev);
    return ev;
  }
  const q = new URLSearchParams({ sendUpdates: e.sendInvites ? "all" : "none" });
  return toEvent(await googleFetch<GEvent>(`${API}?${q}`, {
    method: "POST",
    body: JSON.stringify({
      summary: e.title, description: e.description, location: e.location,
      start: { dateTime: e.start }, end: { dateTime: e.end },
      attendees: e.attendees?.map((email) => ({ email })),
    }),
  }));
}

const demoCreated: CalendarEvent[] = [];

function sampleEvents(from: Date, to: Date): CalendarEvent[] {
  // A fixed weekday pattern anchored to each local day in the range, so the demo always has a schedule.
  const out: CalendarEvent[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  for (; day < to; day.setDate(day.getDate() + 1)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;
    const id = day.toISOString().slice(0, 10);
    out.push(
      { id: `${id}-a`, title: "Team standup", start: at(day, 9), end: at(day, 9, 30), allDay: false, attendees: ["team@yourco.com"] },
      { id: `${id}-b`, title: dow % 2 ? "Acme Corp — sponsorship call" : "Venue walkthrough prep", start: at(day, 11), end: at(day, 11, 45), allDay: false, attendees: dow % 2 ? ["priya@acmecorp.com"] : [] },
      { id: `${id}-c`, title: "Focus: Spring Summit plan", start: at(day, 14), end: at(day, 16), allDay: false, attendees: [] },
    );
  }
  return [...out, ...demoCreated]
    .filter((e) => new Date(e.start) < to && new Date(e.end) > from)
    .sort((a, b) => a.start.localeCompare(b.start));
}
