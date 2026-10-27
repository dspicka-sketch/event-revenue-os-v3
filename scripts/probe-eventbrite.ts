// First-live-run diagnostic: npm run probe:eventbrite
// Reads EVENTBRITE_TOKEN / EVENTBRITE_ORGANIZATION_ID / EVENTBRITE_EVENT_ID from
// .env, makes read-only requests, and writes reports/eventbrite-probe-<date>.md
// (+ .json). The report holds counts, field names and enum values only.
import { mkdir, writeFile } from "node:fs/promises";
import { EventbriteClient } from "../src/providers/eventbrite/client.js";
import { probeEventbrite, probeToMarkdown } from "../src/providers/eventbrite/probe.js";
import { actionFor, ProviderError } from "../src/providers/errors.js";

const token = process.env.EVENTBRITE_TOKEN;
const organizationId = process.env.EVENTBRITE_ORGANIZATION_ID;
const eventId = process.env.EVENTBRITE_EVENT_ID;
if (!token || !organizationId || !eventId) {
  console.error("Set EVENTBRITE_TOKEN, EVENTBRITE_ORGANIZATION_ID and EVENTBRITE_EVENT_ID in .env first (see README → Live setup).");
  process.exit(1);
}
try {
  const report = await probeEventbrite(new EventbriteClient({ token, maxRequests: 400 }), { organizationId, eventId });
  await mkdir("reports", { recursive: true });
  const base = `reports/eventbrite-probe-${report.generatedAt.slice(0, 10)}`;
  await writeFile(`${base}.md`, probeToMarkdown(report));
  await writeFile(`${base}.json`, JSON.stringify(report, null, 2));
  console.log(report.findings.map((f) => `- ${f}`).join("\n"));
  console.log(`\nWrote ${base}.md and ${base}.json (${report.requestsMade} requests). Share the .md with the developer.`);
} catch (e) {
  if (e instanceof ProviderError) {
    console.error(`Probe failed [${e.kind}]: ${e.message}\n${actionFor(e.kind)}`);
    process.exitCode = 1;
  } else throw e;
}
