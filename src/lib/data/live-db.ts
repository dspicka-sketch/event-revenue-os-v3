import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StaleVersionError, type Db, type ListOptions, type Row } from "./db";
import type { MemberRole } from "../orchestrator/types";

export class LiveDb implements Db {
  readonly mode = "live" as const;
  constructor(
    private readonly sb: SupabaseClient,
    readonly projectId: string,
    readonly userId: string,
    readonly userEmail: string | null,
    readonly role: MemberRole,
  ) {}

  async list<T extends Row>(table: string, opts: ListOptions = {}): Promise<T[]> {
    let q: any = this.sb.from(table).select("*");
    if (table !== "projects") q = q.eq("project_id", this.projectId);
    for (const [k, v] of Object.entries(opts.eq ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
    if (opts.in) q = q.in(opts.in.column, opts.in.values);
    q = q.order(opts.order ?? "created_at", { ascending: !opts.desc });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as T[];
  }

  async get<T extends Row>(table: string, id: string): Promise<T | null> {
    let q: any = this.sb.from(table).select("*").eq("id", id);
    if (table !== "projects") q = q.eq("project_id", this.projectId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    return (data as T) ?? null;
  }

  async insert<T extends Row>(table: string, row: Row): Promise<T> {
    const { data, error } = await this.sb.from(table).insert({ ...row, project_id: this.projectId }).select("*").single();
    if (error) throw new Error(error.message);
    return data as T;
  }

  async update<T extends Row>(table: string, id: string, rowVersion: number, patch: Row): Promise<T> {
    const { data, error } = await this.sb
      .from(table)
      .update({ ...patch, row_version: rowVersion })
      .eq("id", id)
      .eq("project_id", this.projectId)
      .eq("row_version", rowVersion)
      .select("*")
      .maybeSingle();
    if (error) {
      if (/stale_version/.test(error.message)) throw new StaleVersionError(table);
      throw new Error(error.message);
    }
    if (!data) throw new StaleVersionError(table);
    return data as T;
  }

  async rpc<T>(fn: string, args: Row): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
}
