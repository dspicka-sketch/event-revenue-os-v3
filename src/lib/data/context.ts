import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { appMode } from "../config";
import type { Db } from "./db";
import type { MemberRole } from "../orchestrator/types";

/** Resolve the signed-in user's project database handle, or redirect. Cached per request. */
export const getDb = cache(async (): Promise<Db> => {
  const mode = appMode();
  if (mode === "setup") redirect("/setup");
  if (mode === "demo") {
    const { DemoDb } = await import("./demo-db");
    return new DemoDb();
  }
  const { supabaseServer } = await import("../supabase/server");
  const { LiveDb } = await import("./live-db");
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: membership } = await sb
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", auth.user.id)
    .eq("access_state", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/no-access");
  return new LiveDb(sb, membership.project_id, auth.user.id, auth.user.email ?? null, membership.role as MemberRole);
});

export async function requireEditor(): Promise<Db> {
  const db = await getDb();
  if (db.role !== "owner" && db.role !== "editor") throw new Error("Viewers cannot make changes.");
  return db;
}

export async function requireOwner(): Promise<Db> {
  const db = await getDb();
  if (db.role !== "owner") throw new Error("Only the project owner can do this.");
  return db;
}
