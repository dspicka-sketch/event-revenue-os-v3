import type { MemberRole } from "../orchestrator/types";

export type Row = Record<string, any>;

export interface ListOptions {
  eq?: Record<string, string | number | boolean | null>;
  order?: string;
  desc?: boolean;
  limit?: number;
  in?: { column: string; values: string[] };
}

export class StaleVersionError extends Error {
  constructor(table: string) {
    super(`This ${table} record was changed by someone else. Reload and try again.`);
  }
}

/**
 * Minimal data-access surface used by pages and server actions. The live implementation
 * runs as the signed-in user so Postgres RLS applies to every read and write.
 */
export interface Db {
  readonly mode: "live" | "demo";
  readonly projectId: string;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly role: MemberRole;
  list<T extends Row = Row>(table: string, opts?: ListOptions): Promise<T[]>;
  get<T extends Row = Row>(table: string, id: string): Promise<T | null>;
  insert<T extends Row = Row>(table: string, row: Row): Promise<T>;
  /** Optimistic update: fails with StaleVersionError when row_version no longer matches. */
  update<T extends Row = Row>(table: string, id: string, rowVersion: number, patch: Row): Promise<T>;
  rpc<T = unknown>(fn: string, args: Row): Promise<T>;
}

export function canEdit(db: Db) {
  return db.role === "owner" || db.role === "editor";
}
