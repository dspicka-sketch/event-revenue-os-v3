import { NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/data/context";
import { extractText } from "@/lib/extract";

export const runtime = "nodejs";

/** Retry a failed extraction from the privately stored original. */
export async function POST(req: NextRequest) {
  const db = await requireEditor();
  const form = await req.formData();
  const v = await db.get("source_versions", String(form.get("version_id")));
  const to = (path: string, q: string) => NextResponse.redirect(new URL(`${path}?${q}`, req.url), 303);
  if (!v) return to("/evidence", "error=Version%20not%20found");
  if (db.mode !== "live" || !v.storage_key) return to(`/evidence/sources/${v.source_id}`, "error=Original%20bytes%20are%20not%20stored%20in%20this%20mode");
  const { supabaseServer } = await import("@/lib/supabase/server");
  const { data, error } = await (await supabaseServer()).storage.from("sources").download(v.storage_key);
  if (error || !data) return to(`/evidence/sources/${v.source_id}`, `error=${encodeURIComponent(error?.message ?? "download failed")}`);
  const x = await extractText(v.mime_type, new Uint8Array(await data.arrayBuffer()));
  await db.update("source_versions", v.id, v.row_version, {
    extraction_state: x.state,
    extracted_text: x.text,
    extraction_error: x.error,
    extraction_attempts: (v.extraction_attempts ?? 0) + 1,
    ocr_limitations: x.ocrLimitations,
  });
  return to(`/evidence/sources/${v.source_id}`, `msg=${encodeURIComponent(`Extraction ${x.state}`)}`);
}
