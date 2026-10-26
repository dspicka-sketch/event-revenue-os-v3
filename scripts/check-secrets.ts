// Scan tracked files and the built web bundle for credential-like strings and
// patron PII patterns. Run after `npm run build`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const PATTERNS: [string, RegExp][] = [
  ["Bearer token literal", /Bearer\s+[A-Za-z0-9]{16,}/],
  ["Eventbrite-style private token", /\b[A-Z0-9]{20}\b/],
  ["Email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["Phone number", /\+?1?[ -.(]*\d{3}[ -.)]*\d{3}[ -.]\d{4}\b/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^:\s]+:(?!CHANGE_ME@)[^@\s]+@/],
];
const ALLOW = [/noreply@anthropic\.com/, /example\.(com|org)/];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !f.endsWith("package-lock.json") && !f.endsWith("check-secrets.ts"));
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
if (existsSync("dist/web")) files.push(...walk("dist/web"));

let findings = 0;
for (const f of files) {
  if (!existsSync(f) || statSync(f).isDirectory()) continue;
  const text = readFileSync(f, "utf8");
  for (const [name, re] of PATTERNS) {
    const g = new RegExp(re.source, "g");
    for (const m of text.matchAll(g)) {
      if (ALLOW.some((a) => a.test(m[0]))) continue;
      findings++;
      console.log(`${f}: ${name}: ${m[0].slice(0, 6)}…`);
    }
  }
}
console.log(findings ? `${findings} potential finding(s).` : `No credential or PII patterns found in ${files.length} files.`);
process.exitCode = findings ? 1 : 0;
