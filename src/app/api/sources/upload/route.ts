import { NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/data/context";
import { sha256Hex } from "@/lib/domain/evidence";
import { EXTRACTOR_VERSION, extractText, validateUpload } from "@/lib/extract";

export const runtime = "nodejs";

function back(req: NextRequest, path: string, q: Record<string, string>) {
  const u = new URL(path, req.url);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

export async function POST(req: NextRequest) {
  let db;
  try {
    db = await requireEditor();
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    return back(req, "/evidence", { error: (e as Error).message });
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { mime } = validateUpload(file.name, file.type, bytes);
    const checksum = sha256Hex(bytes);

    // Same bytes already in this project → no duplicate source or claims.
    const dup = (await db.list("source_versions", { eq: { checksum_sha256: checksum } }))[0];
    if (dup) return back(req, `/evidence/sources/${dup.source_id}`, { msg: "This exact file was already uploaded; showing the existing source." });

    const accessClass = ["confidential", "restricted", "internal"].includes(String(form.get("access_classification"))) ? String(form.get("access_classification")) : "confidential";
    const existingId = typeof form.get("source_id") === "string" && form.get("source_id") ? String(form.get("source_id")) : null;
    const source = existingId
      ? await db.get("sources", existingId)
      : await db.insert("sources", {
          kind: mime === "message/rfc822" ? "email" : "document",
          title: (typeof form.get("title") === "string" && String(form.get("title")).trim()) || file.name,
          source_date: (typeof form.get("source_date") === "string" && String(form.get("source_date"))) || null,
          access_classification: accessClass,
          availability: "available",
          retrieved_at: new Date().toISOString(),
          retrieved_by: db.userEmail ?? db.userId,
          created_by: db.userId,
        });
    if (!source) throw new Error("Source not found.");
    const prior = await db.list("source_versions", { eq: { source_id: source.id }, order: "version_no", desc: true, limit: 1 });
    const versionNo = (prior[0]?.version_no ?? 0) + 1;
    const storageKey = `${db.projectId}/${source.id}/${checksum}`;

    if (db.mode === "live") {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const sb = await supabaseServer();
      const { error } = await sb.storage.from("sources").upload(storageKey, bytes, { contentType: mime, upsert: false });
      if (error && !/exists/i.test(error.message)) throw new Error(`Storage upload failed: ${error.message}`);
    }

    const version = await db.insert("source_versions", {
      source_id: source.id,
      version_no: versionNo,
      storage_key: db.mode === "live" ? storageKey : null,
      checksum_sha256: checksum,
      mime_type: mime,
      size_bytes: bytes.byteLength,
      original_filename: file.name.slice(0, 200),
      extraction_state: "running",
      extractor_version: EXTRACTOR_VERSION,
      created_by: db.userId,
    });
    const x = await extractText(mime, bytes);
    await db.update("source_versions", version.id, version.row_version, {
      extraction_state: x.state,
      extracted_text: x.text,
      extraction_error: x.error,
      extraction_attempts: 1,
      ocr_used: x.ocrUsed,
      ocr_limitations: x.ocrLimitations,
    });
    if (existingId && source.availability !== "available") {
      await db.update("sources", source.id, source.row_version, { availability: "available", retrieved_at: new Date().toISOString(), retrieved_by: db.userEmail ?? db.userId });
    }
    return back(req, `/evidence/sources/${source.id}`, { msg: x.state === "succeeded" ? "Uploaded and extracted. Record claims with exact locators." : `Uploaded. ${x.error}` });
  } catch (e) {
    return back(req, "/evidence", { error: (e as Error).message });
  }
}
