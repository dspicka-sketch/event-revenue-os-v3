import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Activity, Briefing, EmailTriage, SponsorDeal, Task } from "./types";

export type DealInput = Partial<Omit<SponsorDeal, "id" | "created_at" | "updated_at">>;

export interface Store {
  mode: "supabase" | "demo";
  listTasks(opts?: { status?: Task["status"] | "active" }): Promise<Task[]>;
  createTask(t: Partial<Task> & { title: string }): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task>;
  upsertTriage(e: Omit<EmailTriage, "triaged_at">): Promise<EmailTriage>;
  listTriage(): Promise<EmailTriage[]>;
  saveBriefing(content: string): Promise<Briefing>;
  latestBriefing(): Promise<Briefing | null>;
  log(kind: string, summary: string): Promise<void>;
  listActivity(limit?: number): Promise<Activity[]>;
  listDeals(): Promise<SponsorDeal[]>;
  createDeal(d: DealInput & { sponsor: string }): Promise<SponsorDeal>;
  updateDeal(id: string, patch: DealInput): Promise<SponsorDeal>;
}

const now = () => new Date().toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function supabaseStore(db: SupabaseClient): Store {
  const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  return {
    mode: "supabase",
    async listTasks(opts) {
      let q = db.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false });
      if (opts?.status === "active") q = q.neq("status", "done");
      else if (opts?.status) q = q.eq("status", opts.status);
      return must(await q);
    },
    async createTask(t) {
      return must(await db.from("tasks").insert(t).select().single());
    },
    async updateTask(id, patch) {
      return must(await db.from("tasks").update(patch).eq("id", id).select().single());
    },
    async upsertTriage(e) {
      return must(await db.from("email_triage").upsert({ ...e, triaged_at: now() }).select().single());
    },
    async listTriage() {
      return must(await db.from("email_triage").select("*").order("received_at", { ascending: false }).limit(50));
    },
    async saveBriefing(content) {
      return must(await db.from("briefings").insert({ content }).select().single());
    },
    async latestBriefing() {
      return must(await db.from("briefings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle());
    },
    async log(kind, summary) {
      await db.from("activity").insert({ kind, summary });
    },
    async listActivity(limit = 20) {
      return must(await db.from("activity").select("*").order("created_at", { ascending: false }).limit(limit));
    },
    async listDeals() {
      return must(await db.from("sponsor_deals").select("*").order("next_step_due", { ascending: true, nullsFirst: false }));
    },
    async createDeal(d) {
      return must(await db.from("sponsor_deals").insert(d).select().single());
    },
    async updateDeal(id, patch) {
      return must(await db.from("sponsor_deals").update({ ...patch, updated_at: now() }).eq("id", id).select().single());
    },
  };
}

interface DemoData {
  tasks: Task[];
  triage: Map<string, EmailTriage>;
  briefings: Briefing[];
  activity: Activity[];
  deals: SponsorDeal[];
}

function seed(): DemoData {
  const mk = (title: string, due: number | null, priority: Task["priority"], notes: string | null = null): Task => ({
    id: crypto.randomUUID(), title, notes, due_date: due === null ? null : daysFromNow(due),
    priority, status: "open", source: "seed", created_at: now(),
  });
  return {
    tasks: [
      mk("Send Q4 sponsorship deck to Acme Corp", 0, "high", "They asked for updated tier pricing."),
      mk("Approve venue deposit for Spring Summit", 1, "high"),
      mk("Follow up with Jordan on ticketing integration", 2, "medium"),
      mk("Review last month's event P&L", 5, "medium"),
      mk("Book flights for Austin site visit", null, "low"),
    ],
    triage: new Map(),
    briefings: [],
    activity: [],
    deals: [
      deal("Acme Corp", "pitched", 2500000, "Send updated platinum/gold pricing", 3, "Platinum", "Priya Shah"),
      deal("Northwind Brewing", "negotiating", 1200000, "Confirm sampling rights with venue", -1, "Bar partner", "Sam Ortiz"),
      deal("Lumen Audio", "verbal", 800000, "Send contract for signature", 1, "Stage sponsor"),
      deal("Harbor Credit Union", "lead", null, "Intro call", 6),
      deal("Fieldhouse Apparel", "signed", 1500000, null, null, "Merch partner"),
    ],
  };
}

function deal(sponsor: string, stage: SponsorDeal["stage"], amount_minor: number | null, next_step: string | null, dueIn: number | null, tier: string | null = null, contact: string | null = null): SponsorDeal {
  return {
    id: crypto.randomUUID(), sponsor, contact, event_name: "Spring Summit", tier, stage, amount_minor, currency: "USD",
    next_step, next_step_due: dueIn === null ? null : daysFromNow(dueIn), notes: null, created_at: now(), updated_at: now(),
  };
}

function demoStore(): Store {
  const g = globalThis as unknown as { __eaDemo?: DemoData };
  const d = (g.__eaDemo ??= seed());
  return {
    mode: "demo",
    async listTasks(opts) {
      return d.tasks
        .filter((t) => !opts?.status || (opts.status === "active" ? t.status !== "done" : t.status === opts.status))
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    },
    async createTask(t) {
      const task: Task = {
        id: crypto.randomUUID(), notes: null, due_date: null, priority: "medium",
        status: "open", source: "manual", created_at: now(), ...t,
      };
      d.tasks.push(task);
      return task;
    },
    async updateTask(id, patch) {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) throw new Error(`Task ${id} not found`);
      Object.assign(t, patch);
      return t;
    },
    async upsertTriage(e) {
      const row = { ...e, triaged_at: now() };
      d.triage.set(e.message_id, row);
      return row;
    },
    async listTriage() {
      return [...d.triage.values()].sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
    },
    async saveBriefing(content) {
      const b = { id: crypto.randomUUID(), content, created_at: now() };
      d.briefings.unshift(b);
      return b;
    },
    async latestBriefing() {
      return d.briefings[0] ?? null;
    },
    async log(kind, summary) {
      d.activity.unshift({ id: crypto.randomUUID(), kind, summary, created_at: now() });
    },
    async listActivity(limit = 20) {
      return d.activity.slice(0, limit);
    },
    async listDeals() {
      return [...d.deals].sort((a, b) => (a.next_step_due ?? "9999").localeCompare(b.next_step_due ?? "9999"));
    },
    async createDeal(input) {
      const row: SponsorDeal = {
        id: crypto.randomUUID(), contact: null, event_name: null, tier: null, stage: "lead", amount_minor: null,
        currency: "USD", next_step: null, next_step_due: null, notes: null, created_at: now(), updated_at: now(), ...input,
      };
      d.deals.push(row);
      return row;
    },
    async updateDeal(id, patch) {
      const row = d.deals.find((x) => x.id === id);
      if (!row) throw new Error(`Deal ${id} not found`);
      Object.assign(row, patch, { updated_at: now() });
      return row;
    },
  };
}

let cached: Store | undefined;
export function getStore(): Store {
  if (cached) return cached;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  cached = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? supabaseStore(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }))
    : demoStore();
  return cached;
}
