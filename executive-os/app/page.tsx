"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import type { Activity, Briefing, CalendarEvent, EmailTriage, Task } from "@/lib/types";
import type { PulseResponse, ShowCard } from "../../src/shared/apiTypes";
import { formatMoneyCompact } from "../../src/domain/money";

interface Dashboard {
  tasks: Task[];
  triage: EmailTriage[];
  briefing: Briefing | null;
  activity: Activity[];
  events: CalendarEvent[];
  revos: { pulse: PulseResponse | null; error: string | null } | null;
  integrations: { claude: boolean; store: "supabase" | "demo"; google: boolean; revos: boolean };
}
interface ChatMsg { role: "user" | "assistant"; content: string }

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" | "accent" }) {
  const color = { danger: "text-danger", warn: "text-warn", accent: "text-accent" }[tone ?? "accent"];
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${value ? color : "text-ink"}`}>{value}</div>
    </div>
  );
}

const Btn = (p: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) => {
  const { primary, className = "", ...rest } = p;
  return (
    <button
      {...rest}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${primary ? "bg-accent text-white hover:opacity-90" : "border border-line hover:bg-bg"} ${className}`}
    />
  );
};

const CATEGORY: Record<EmailTriage["category"], string> = {
  urgent: "bg-danger/15 text-danger",
  reply: "bg-warn/15 text-warn",
  fyi: "bg-accent/15 text-accent",
  ignore: "bg-muted/15 text-muted",
};
const PRIORITY: Record<Task["priority"], string> = { high: "bg-danger", medium: "bg-warn", low: "bg-muted" };

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [newTask, setNewTask] = useState({ title: "", due_date: "" });
  const chatEnd = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    return api<Dashboard>(`/api/dashboard?from=${from.toISOString()}&to=${to.toISOString()}`).then(setData).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, busy]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); await refresh(); } catch (e) { setError(String(e)); } finally { setBusy(null); }
  };

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    const next: ChatMsg[] = [...chat, { role: "user", content: text.trim() }];
    setChat(next); setInput("");
    run("chat", async () => {
      const { reply } = await api<{ reply: string }>("/api/agent", { method: "POST", body: JSON.stringify({ messages: next }) });
      setChat([...next, { role: "assistant", content: reply }]);
    });
  };

  const tasks = data?.tasks ?? [];
  const triage = (data?.triage ?? []).filter((t) => t.category !== "ignore");
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today()).length;
  const dueToday = tasks.filter((t) => t.due_date === today()).length;
  const needsReply = triage.filter((t) => t.category === "urgent" || t.category === "reply").length;
  const drafts = triage.filter((t) => t.draft_id).length;
  const events = data?.events ?? [];
  const nowIso = new Date().toISOString();
  const meetingsLeft = events.filter((e) => !e.allDay && e.end > nowIso && e.attendees.length).length;
  const hour = new Date().getHours();

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="text-2xl font-semibold">Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}</h1>
          {data && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {([["Claude", data.integrations.claude], ["Supabase", data.integrations.store === "supabase"], ["Gmail + Calendar", data.integrations.google], ["RevOS", data.integrations.revos]] as const).map(([n, on]) => (
                <span key={n} className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-ok" : "bg-warn"}`} />
                  {n}{on ? "" : n === "Claude" || n === "RevOS" ? " · not configured" : " · demo"}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Btn disabled={!!busy} onClick={() => run("triage", () => api("/api/triage", { method: "POST" }))}>
            {busy === "triage" ? "Triaging…" : "Triage inbox"}
          </Btn>
          <Btn primary disabled={!!busy} onClick={() => run("briefing", () => api("/api/briefing", { method: "POST" }))}>
            {busy === "briefing" ? "Writing…" : "Generate briefing"}
          </Btn>
        </div>
      </header>

      {error && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open tasks" value={tasks.length} />
        <Stat label="Overdue" value={overdue} tone="danger" />
        <Stat label="Due today" value={dueToday} tone="warn" />
        <Stat label="Needs reply" value={needsReply} tone="warn" />
        <Stat label="Drafts to review" value={drafts} />
        <Stat label="Meetings left today" value={meetingsLeft} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {data?.revos && <RevenuePanel revos={data.revos} />}

          <Panel title="Daily briefing" action={data?.briefing && <span className="text-xs text-muted">{timeAgo(data.briefing.created_at)}</span>}>
            {data?.briefing ? <Markdown text={data.briefing.content} /> : <p className="text-sm text-muted">No briefing yet. Generate one, or it runs automatically weekday mornings.</p>}
          </Panel>

          <Panel title="Priority inbox">
            {triage.length === 0 ? (
              <p className="text-sm text-muted">Nothing triaged yet. Run “Triage inbox”.</p>
            ) : (
              <ul className="divide-y divide-line">
                {triage.map((t) => (
                  <li key={t.message_id} className="flex items-start gap-3 py-2.5">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${CATEGORY[t.category]}`}>{t.category}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.subject}</div>
                      <div className="truncate text-xs text-muted">{t.sender.replace(/<.*>/, "").trim()} · {t.summary}</div>
                    </div>
                    {t.draft_id && <span className="shrink-0 text-xs text-ok">Draft ready</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Tasks & follow-ups">
            <form
              className="mb-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTask.title.trim()) return;
                run("task", () => api("/api/tasks", { method: "POST", body: JSON.stringify({ title: newTask.title, due_date: newTask.due_date || null }) }));
                setNewTask({ title: "", due_date: "" });
              }}
            >
              <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="Add a task…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent" />
              <input type="date" value={newTask.due_date} onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm" />
              <Btn type="submit">Add</Btn>
            </form>
            <ul className="divide-y divide-line">
              {tasks.map((t) => {
                const late = t.due_date && t.due_date < today();
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" aria-label={`Complete ${t.title}`}
                      onChange={() => run("task", () => api("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: t.id, status: "done" }) }))} />
                    <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY[t.priority]}`} title={`${t.priority} priority`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{t.title}</div>
                      {t.notes && <div className="truncate text-xs text-muted">{t.notes}</div>}
                    </div>
                    {t.status === "waiting" && <span className="text-xs text-muted">waiting</span>}
                    {t.due_date && <span className={`shrink-0 text-xs tabular-nums ${late ? "font-medium text-danger" : "text-muted"}`}>{t.due_date === today() ? "Today" : t.due_date}</span>}
                  </li>
                );
              })}
              {tasks.length === 0 && <li className="py-2 text-sm text-muted">All clear.</li>}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Today's schedule">
            {events.length === 0 ? (
              <p className="text-sm text-muted">Nothing on the calendar today.</p>
            ) : (
              <ul className="space-y-1">
                {events.map((e) => {
                  const past = !e.allDay && e.end <= nowIso;
                  const live = !e.allDay && e.start <= nowIso && e.end > nowIso;
                  return (
                    <li key={e.id} className={`flex gap-3 rounded-lg px-2 py-1.5 ${live ? "bg-accent/10" : ""} ${past ? "opacity-50" : ""}`}>
                      <span className="w-16 shrink-0 text-xs tabular-nums text-muted">{e.allDay ? "All day" : clock(e.start)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{e.link ? <a href={e.link} target="_blank" rel="noreferrer" className="hover:underline">{e.title}</a> : e.title}</div>
                        {(e.attendees.length > 0 || e.location) && (
                          <div className="truncate text-xs text-muted">{[e.location, e.attendees.length ? `${e.attendees.length} guest${e.attendees.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                      {live && <span className="shrink-0 text-xs font-medium text-accent">Now</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Assistant" className="flex h-[32rem] flex-col">
            <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
              {chat.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted">Ask me to triage, draft, plan or follow up.</p>
                  {["What needs my attention today?", "Find 30 min this week to prep the Acme call", "What's overdue and what should I push?"].map((s) => (
                    <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-bg">{s}</button>
                  ))}
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-accent px-3 py-2 text-sm text-white" : "mr-4 rounded-lg bg-bg px-3 py-2"}>
                  {m.role === "user" ? m.content : <Markdown text={m.content} />}
                </div>
              ))}
              {busy === "chat" && <div className="mr-4 rounded-lg bg-bg px-3 py-2 text-sm text-muted">Working…</div>}
              <div ref={chatEnd} />
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message your assistant…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
              <Btn primary type="submit" disabled={!!busy || !input.trim()}>Send</Btn>
            </form>
          </Panel>

          <Panel title="Agent activity">
            <ul className="space-y-2">
              {(data?.activity ?? []).map((a) => (
                <li key={a.id} className="flex gap-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-muted">{timeAgo(a.created_at)}</span>
                  <span className="min-w-0 truncate">{a.summary}</span>
                </li>
              ))}
              {!data?.activity.length && <li className="text-sm text-muted">No activity yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </main>
  );
}

function grossLabel(s: ShowCard) {
  const g = s.revenue?.grossAfterRefunds;
  if (!s.currency || !g || g.minor === null) return "—";
  return `${formatMoneyCompact(g.minor, s.currency)}${g.status === "partial" ? "+" : ""}`;
}

function RevenuePanel({ revos }: { revos: NonNullable<Dashboard["revos"]> }) {
  const p = revos.pulse;
  if (!p) return <Panel title="Revenue · RevOS"><p className="text-sm text-danger">Couldn't reach RevOS: {revos.error}</p></Panel>;
  const upcoming = p.shows.filter((s) => s.phase === "upcoming" || s.phase === "today").slice(0, 6);
  const gross = p.summary.upcomingGrossByCurrency
    .map((g) => (g.minor === null ? `— ${g.currency}` : `${formatMoneyCompact(g.minor, g.currency)}${g.status === "partial" ? "+" : ""}`))
    .join(" · ") || "—";
  return (
    <Panel title="Revenue · RevOS" action={p.organization.is_fixture && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-medium text-warn">Sample data</span>}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Upcoming shows", String(p.summary.upcomingShows)], ["Gross after refunds", gross], ["Paid tickets, 7 days", String(p.summary.paidTicketsLast7Days)], ["Need attention", String(p.summary.showsNeedingAttention)]].map(([label, value]) => (
          <div key={label}><div className="text-xs text-muted">{label}</div><div className="text-lg font-semibold tabular-nums">{value}</div></div>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {upcoming.map((s) => {
          const wk = s.pace?.last7DaysPaidTickets, prev = s.pace?.previous7DaysPaidTickets;
          return (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <span className="w-14 shrink-0 text-xs tabular-nums text-muted">{s.daysUntil === 0 ? "Today" : s.daysUntil === null ? "TBD" : `${s.daysUntil}d`}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{s.name}</div>
                <div className="truncate text-xs text-muted">
                  {s.tickets ? `${s.tickets.paid} paid` : "No sales data"}
                  {wk !== undefined && ` · ${wk} this week${prev !== undefined ? ` (${wk >= prev ? "+" : ""}${wk - prev} vs last)` : ""}`}
                  {s.freshness.stale && " · stale"}
                </div>
              </div>
              {s.attention.length > 0 && <span className="shrink-0 text-xs text-warn" title={s.attention.map((a) => a.title).join("\n")}>{s.attention.length} alert{s.attention.length > 1 ? "s" : ""}</span>}
              <span className="w-16 shrink-0 text-right text-sm tabular-nums">{grossLabel(s)}</span>
            </li>
          );
        })}
        {upcoming.length === 0 && <li className="py-2 text-sm text-muted">No upcoming shows.</li>}
      </ul>
    </Panel>
  );
}
