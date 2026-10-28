// Minimal CSV reader for vendor report exports (RFC 4180 shape: quoted fields,
// doubled quotes, CR/LF line ends, optional UTF-8 BOM). No I/O here.

export interface CsvTable {
  headers: string[];
  /** One record per data row, keyed by header. Missing trailing cells are "". */
  rows: Record<string, string>[];
}

export function parseCsv(text: string): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { record.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { record.push(field); records.push(record); record = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }

  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  const rows = nonEmpty.map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}
