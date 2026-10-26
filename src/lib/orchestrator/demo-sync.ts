import "server-only";
import type { MemoryRunStore } from "./memory-store";

/** Demo only: mirror the in-memory run store into the in-memory demo tables the pages read. */
export async function syncDemoTables(store: MemoryRunStore) {
  const g = globalThis as unknown as { __p104demo?: Record<string, any[]> };
  if (!g.__p104demo) {
    const { DemoDb } = await import("../data/demo-db");
    await new DemoDb().list("projects"); // initializes tables
  }
  const t = g.__p104demo!;
  const now = new Date().toISOString();
  t.agent_runs = [...store.runs.values()].map((r) => ({ ...r, updated_at: now, row_version: 1 }));
  t.agent_jobs = [...store.jobs.values()].map((j) => ({ ...j, created_at: now, updated_at: now, row_version: 1 }));
  t.run_events = store.events.map((e, i) => ({ id: `ev-${i}`, project_id: store.runs.get(e.run_id)?.project_id, ...e, created_at: now }));
  const existing = new Map((t.proposals ?? []).map((p: any) => [p.dedupe_key, p]));
  for (const p of store.proposals.values()) {
    if (!existing.has(p.dedupe_key)) existing.set(p.dedupe_key, { id: crypto.randomUUID(), ...p, created_at: now, updated_at: now, row_version: 1 });
  }
  t.proposals = [...existing.values()];
}
