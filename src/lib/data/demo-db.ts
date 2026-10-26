import "server-only";
import { randomUUID } from "node:crypto";
import snapshot from "../../../fixtures/demo-snapshot.json";
import { draftContentHash } from "../domain/evidence";
import { StaleVersionError, type Db, type ListOptions, type Row } from "./db";

/**
 * Isolated DEMO data: an in-memory copy of fixtures/demo-snapshot.json (inherited baseline
 * references + SYNTHETIC records). Changes live only in this server process and are never
 * written anywhere. Enabled only when DEMO_MODE=1; never combined with live credentials.
 */
type Tables = Record<string, Row[]>;
const g = globalThis as unknown as { __p104demo?: Tables };

function tables(): Tables {
  g.__p104demo ??= structuredClone((snapshot as any).tables) as Tables;
  return g.__p104demo;
}

export const DEMO_USER_ID: string = (snapshot as any).demo_owner;
export const DEMO_PROJECT_ID: string = (snapshot as any).project_id;

export class DemoDb implements Db {
  readonly mode = "demo" as const;
  readonly projectId = DEMO_PROJECT_ID;
  readonly userId = DEMO_USER_ID;
  readonly userEmail = "demo-owner@example.invalid";
  readonly role = "owner" as const;

  private t(name: string): Row[] {
    const all = tables();
    all[name] ??= [];
    return all[name];
  }

  async list<T extends Row>(table: string, opts: ListOptions = {}): Promise<T[]> {
    let rows = this.t(table).filter((r) => table === "projects" || r.project_id === this.projectId);
    for (const [k, v] of Object.entries(opts.eq ?? {})) rows = rows.filter((r) => (r[k] ?? null) === v);
    if (opts.in) rows = rows.filter((r) => opts.in!.values.includes(r[opts.in!.column]));
    const key = opts.order ?? "created_at";
    rows = [...rows].sort((a, b) => (String(a[key] ?? "") < String(b[key] ?? "") ? -1 : String(a[key] ?? "") > String(b[key] ?? "") ? 1 : 0));
    if (opts.desc) rows.reverse();
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return structuredClone(rows) as T[];
  }

  async get<T extends Row>(table: string, id: string): Promise<T | null> {
    const r = this.t(table).find((x) => x.id === id);
    return r ? (structuredClone(r) as T) : null;
  }

  async insert<T extends Row>(table: string, row: Row): Promise<T> {
    const now = new Date().toISOString();
    const r: Row = { id: randomUUID(), created_at: now, updated_at: now, row_version: 1, ...row, project_id: this.projectId };
    if (table === "drafts") r.content_hash = draftContentHash(r.title, r.audience, r.body);
    this.t(table).push(r);
    return structuredClone(r) as T;
  }

  async update<T extends Row>(table: string, id: string, rowVersion: number, patch: Row): Promise<T> {
    const r = this.t(table).find((x) => x.id === id);
    if (!r || r.row_version !== rowVersion) throw new StaleVersionError(table);
    if (table === "decisions" && patch.state && patch.state !== "open") Object.assign(patch, { decided_by: this.userId, decided_at: new Date().toISOString() });
    if (table === "drafts" && (patch.body !== undefined || patch.title !== undefined || patch.audience !== undefined)) {
      const next = { ...r, ...patch };
      const h = draftContentHash(next.title, next.audience, next.body);
      if (h !== r.content_hash) {
        patch.content_hash = h;
        patch.state = "draft";
        for (const a of this.t("approvals")) if (a.record_id === id && ["requested", "approved"].includes(a.state)) a.state = "invalidated";
      }
    }
    Object.assign(r, patch, { row_version: r.row_version + 1, updated_at: new Date().toISOString() });
    return structuredClone(r) as T;
  }

  async rpc<T>(fn: string): Promise<T> {
    throw new Error(`RPC ${fn} is not available in demo mode`);
  }
}
