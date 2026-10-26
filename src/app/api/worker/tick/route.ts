import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { appMode } from "@/lib/config";
import { orchestrator, runStore } from "@/lib/orchestrator/factory";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Durable-recovery worker. Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET).
 * Resumes queued runs and runs whose job leases expired (e.g. the request that started
 * them was terminated). Completed jobs are checkpointed and never re-executed.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret ?? ""}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (appMode() !== "live") return NextResponse.json({ skipped: "not live" });
  const ids = await (await runStore()).listResumableRuns(5);
  const results: { id: string; state: string }[] = [];
  for (const id of ids) {
    const run = await (await orchestrator(`cron-${Date.now()}`)).execute(id);
    results.push({ id, state: run.state });
  }
  return NextResponse.json({ resumed: results });
}
