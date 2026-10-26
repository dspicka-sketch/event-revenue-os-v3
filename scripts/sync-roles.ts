// Regenerates role-derived instruction files from src/lib/domain/roles.ts.
//   npm run roles:sync   — write files
//   npm run roles:check  — exit 1 if any derived file has drifted
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROLES, ROLE_KEYS, SPECIALIST_KEYS, ROLE_SPEC_VERSION, renderRoleInstructions, type RoleKey } from "../src/lib/domain/roles";

const root = join(__dirname, "..");
const HEADER = `<!-- GENERATED from src/lib/domain/roles.ts (${ROLE_SPEC_VERSION}). Edit the spec, then run npm run roles:sync. -->`;

function claudeAgent(key: RoleKey): string {
  const r = ROLES[key];
  const tools = key === "chief_of_staff" ? "Read, Grep, Glob, Bash, Edit, Write" : "Read, Grep, Glob";
  return [
    "---",
    `name: ${key.replaceAll("_", "-")}`,
    `description: Development-time ${r.title} reviewer for Protect 104. Use to review code, prompts, seed data, and UI copy for ${r.responsibility.toLowerCase()} Read-only unless it is the chief-of-staff integration owner.`,
    `tools: ${tools}`,
    "---",
    HEADER,
    "",
    "You are a Claude Code DEVELOPMENT subagent for the Protect 104 repository. Your existence is not",
    "evidence that the deployed application has agents; the runtime agents live in src/lib/orchestrator",
    "and agent/. Review changes in this repository against the role below. Report concrete file:line",
    "findings. Never add real contacts, grants, deadlines, or funding to fixtures.",
    "",
    renderRoleInstructions(key),
  ].join("\n");
}

function eveRoot(): string {
  return [
    HEADER,
    "",
    renderRoleInstructions("chief_of_staff"),
    "## How you work in this application",
    "- You are the conversational front door. Project records in the database are authoritative; this chat is not.",
    "- Use `start_investigation` to dispatch a durable run. The application chooses relevant specialists (max concurrency 3) and validates their output.",
    "- Use `get_run_brief` to read results and `list_open_items` for decisions, tasks and risks. Link every point to a record or source.",
    "- You cannot send messages, publish, submit, sign, or spend. Offer drafts for the dashboard review queue instead.",
    "- Never surface more than three actions for Daniel at once.",
    "",
  ].join("\n");
}

const files: Record<string, string> = {};
for (const k of ROLE_KEYS) files[join(".claude/agents", `${k.replaceAll("_", "-")}.md`)] = claudeAgent(k);
files["agent/instructions.md"] = eveRoot();
for (const k of SPECIALIST_KEYS) files[join("docs/roles", `${k}.md`)] = `${HEADER}\n\n${renderRoleInstructions(k)}`;

const check = process.argv.includes("--check");
let drift = 0;
for (const [rel, content] of Object.entries(files)) {
  const abs = join(root, rel);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  if (current === content) continue;
  if (check) {
    console.error(`drift: ${rel}`);
    drift++;
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`wrote ${rel}`);
  }
}
if (check && drift) process.exit(1);
if (check) console.log(`roles in sync (${ROLE_SPEC_VERSION})`);
