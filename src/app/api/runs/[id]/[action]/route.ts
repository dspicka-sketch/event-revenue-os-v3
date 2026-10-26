import { after, NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/data/context";
import { orchestrator, runStore } from "@/lib/orchestrator/factory";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const db = await requireEditor();
  const o = await orchestrator();
  const sync = async () => {
    if (db.mode !== "demo") return;
    const { syncDemoTables } = await import("@/lib/orchestrator/demo-sync");
    await syncDemoTables((await runStore()) as any);
  };
  const to = (q: string) => NextResponse.redirect(new URL(`/runs/${id}?${q}`, req.url), 303);
  try {
    const run = await (await runStore()).getRun(id);
    if (!run || run.project_id !== db.projectId) return to("error=Run%20not%20found");
    if (action === "cancel") {
      await o.requestCancel(id, db.userId);
      await sync();
      return to("msg=Cancellation%20requested;%20no%20new%20model%20or%20tool%20calls%20will%20start");
    }
    if (action === "retry" || action === "resume") {
      const n = action === "retry" ? await o.retryFailed(id, db.userId) : 0;
      after(async () => {
        await (await orchestrator()).execute(id);
        await sync();
      });
      return to(`msg=${encodeURIComponent(action === "retry" ? `Retrying ${n} failed job(s); completed work is kept` : "Resuming")}`);
    }
    return to("error=Unknown%20action");
  } catch (e) {
    return to(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
