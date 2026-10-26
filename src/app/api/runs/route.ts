import { after, NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/data/context";
import { orchestrator, runStore } from "@/lib/orchestrator/factory";
import { SPECIALIST_KEYS, type SpecialistKey } from "@/lib/domain/roles";

export const runtime = "nodejs";
export const maxDuration = 300;

async function syncIfDemo(mode: string) {
  if (mode !== "demo") return;
  const { syncDemoTables } = await import("@/lib/orchestrator/demo-sync");
  await syncDemoTables((await runStore()) as any);
}

export async function POST(req: NextRequest) {
  const db = await requireEditor();
  const form = await req.formData();
  const question = String(form.get("question") ?? "").trim();
  const kind = form.get("kind") === "brief" ? "brief" : "investigation";
  const key = String(form.get("idempotency_key") ?? "");
  const roles = form.getAll("roles").map(String).filter((r): r is SpecialistKey => (SPECIALIST_KEYS as string[]).includes(r));
  const back = (q: string) => NextResponse.redirect(new URL(`/runs?${q}`, req.url), 303);
  if (!question) return back("error=Enter%20a%20question");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(key)) return back("error=Missing%20submission%20key;%20reload%20the%20page");
  try {
    const o = await orchestrator();
    const { run, created } = await o.startRun({ projectId: db.projectId, userId: db.userId, kind, question, idempotencyKey: key, roles: roles.length ? roles : undefined });
    await syncIfDemo(db.mode);
    if (created) {
      after(async () => {
        await (await orchestrator()).execute(run.id);
        await syncIfDemo(db.mode);
      });
    }
    return NextResponse.redirect(new URL(`/runs/${run.id}${created ? "" : "?msg=Duplicate%20submission%20ignored"}`, req.url), 303);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
