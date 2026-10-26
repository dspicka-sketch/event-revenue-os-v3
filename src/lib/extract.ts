import "server-only";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const EXTRACTOR_VERSION = "p104-extract@1";

const ALLOWED: Record<string, { exts: string[]; magic?: (b: Uint8Array) => boolean }> = {
  "application/pdf": { exts: [".pdf"], magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  "text/plain": { exts: [".txt"] },
  "text/markdown": { exts: [".md"] },
  "text/html": { exts: [".html", ".htm"] },
  "message/rfc822": { exts: [".eml"] },
  "image/png": { exts: [".png"], magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { exts: [".jpg", ".jpeg"], magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { exts: [".docx"], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
};

export function validateUpload(name: string, mime: string, bytes: Uint8Array): { mime: string } {
  if (bytes.byteLength === 0) throw new Error("File is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("File exceeds 25 MB.");
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  const type = Object.entries(ALLOWED).find(([m, v]) => (m === mime || !mime || mime === "application/octet-stream") && v.exts.includes(ext));
  if (!type) throw new Error(`Unsupported file type (${mime || "unknown"} ${ext}).`);
  const [m, spec] = type;
  if (spec.magic && !spec.magic(bytes)) throw new Error("File contents do not match its type.");
  return { mime: m };
}

export interface Extraction {
  state: "succeeded" | "failed";
  text: string | null;
  error: string | null;
  ocrUsed: boolean;
  ocrLimitations: string | null;
}

/** Extract text in-process from untrusted bytes. No code from the file is executed. */
export async function extractText(mime: string, bytes: Uint8Array): Promise<Extraction> {
  try {
    if (mime.startsWith("text/") || mime === "message/rfc822") {
      let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (mime === "text/html") text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      return ok(text);
    }
    if (mime === "application/pdf") {
      const { extractText: pdf } = await import("unpdf");
      const r = await pdf(new Uint8Array(bytes), { mergePages: false });
      const pages = (r.text as string[]).map((t, i) => `[page ${i + 1}]\n${t}`);
      const text = pages.join("\n\n");
      if (text.replace(/\[page \d+\]/g, "").trim().length < 20) {
        return { state: "failed", text: text || null, error: "No text layer found (scanned/image PDF). OCR is not configured; a human must transcribe or an OCR extractor must be added.", ocrUsed: false, ocrLimitations: "Image-based pages were not read." };
      }
      return ok(text);
    }
    if (mime.startsWith("image/")) {
      return { state: "failed", text: null, error: "OCR is not configured for images. Transcribe manually or enable an OCR extractor.", ocrUsed: false, ocrLimitations: "Image not read." };
    }
    return { state: "failed", text: null, error: `No extractor available for ${mime} yet. Upload a PDF export instead.`, ocrUsed: false, ocrLimitations: null };
  } catch (e) {
    return { state: "failed", text: null, error: `Extraction failed: ${(e as Error).message}`.slice(0, 500), ocrUsed: false, ocrLimitations: null };
  }
}

function ok(text: string): Extraction {
  return { state: "succeeded", text: text.slice(0, 2_000_000), error: null, ocrUsed: false, ocrLimitations: null };
}
