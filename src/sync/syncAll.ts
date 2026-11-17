// Scheduled sweep (D19): refresh every live show, one at a time. One show's
// failure never stops the rest; every failure is named in the result.

import type { Db } from "../db/pool.js";
import { listSyncableEvents } from "../db/repo.js";
import { defaultAdapterFactory, syncEvent, type AdapterFactory } from "./syncEvent.js";

export interface SweepFailure {
  organizationId: string;
  eventId: string;
  name: string;
  kind: string;
  message: string;
}

export interface SweepResult {
  startedAt: string;
  finishedAt: string;
  attempted: number;
  succeeded: number;
  failures: SweepFailure[];
}

export async function syncAllEvents(db: Db, opts: { now: Date; adapterFactory?: AdapterFactory }): Promise<SweepResult> {
  const startedAt = new Date().toISOString();
  const events = await listSyncableEvents(db, opts.now);
  const failures: SweepFailure[] = [];
  let succeeded = 0;
  for (const e of events) {
    const base = { organizationId: e.organizationId, eventId: e.eventId, name: e.name };
    try {
      const out = await syncEvent(db, e.organizationId, e.eventId, opts.adapterFactory ?? defaultAdapterFactory, () => opts.now);
      if (out.ok) succeeded++;
      else failures.push({ ...base, kind: out.kind, message: out.message });
    } catch (err) {
      failures.push({ ...base, kind: "unexpected", message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { startedAt, finishedAt: new Date().toISOString(), attempted: events.length, succeeded, failures };
}
