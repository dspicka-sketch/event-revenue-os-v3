import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/data/context";
import { buildExport } from "@/lib/export";

export const runtime = "nodejs";

/** Export the project's records (RLS-scoped to the caller). No signed URLs, storage keys, extracted text or secrets. */
export async function GET() {
  const db = await requireEditor();
  const projects = await db.list("projects");
  const p = projects.find((x) => x.id === db.projectId) ?? projects[0];
  const exp = await buildExport({ id: p.id, name: p.name, mission: p.mission, timezone: p.timezone, stage: p.stage }, (t) => db.list(t));
  return new NextResponse(JSON.stringify(exp, null, 1), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="protect104-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
