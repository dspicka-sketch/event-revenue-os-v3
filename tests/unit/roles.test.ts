// Adapter test: development-layer and runtime-layer instructions must come from the same spec.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLES, ROLE_KEYS, SPECIALIST_KEYS, renderRoleInstructions } from "@/lib/domain/roles";
import { planSpecialists } from "@/lib/orchestrator/planner";

describe("role specification", () => {
  it("has a chief plus exactly seven specialists", () => {
    expect(ROLE_KEYS).toHaveLength(8);
    expect(SPECIALIST_KEYS).toHaveLength(7);
  });

  it("derived files are in sync with the spec", () => {
    const out = execFileSync("npx", ["tsx", "scripts/sync-roles.ts", "--check"], { encoding: "utf8" });
    expect(out).toMatch(/roles in sync/);
  });

  it("runtime prompts and Claude Code agents carry the same prohibited behaviors", () => {
    for (const k of ROLE_KEYS) {
      const dev = readFileSync(`.claude/agents/${k.replaceAll("_", "-")}.md`, "utf8");
      for (const p of ROLES[k].prohibited) expect(dev).toContain(p);
      expect(dev).toContain(renderRoleInstructions(k));
    }
  });

  it("general counsel disclaims legal representation", () => {
    expect(renderRoleInstructions("general_counsel")).toMatch(/Not a lawyer; creates no attorney-client relationship or privilege/);
  });

  it("every specialist is reachable by dispatch", () => {
    const qs: Record<string, string> = {
      public_policy: "zoning permit", fundraising: "grant funding", community_outreach: "stakeholder outreach",
      data_engineer: "extract rent roll data", niva_liaison: "NIVA resources", strategist: "ownership strategy", general_counsel: "lease title",
    };
    for (const k of SPECIALIST_KEYS) expect(planSpecialists(qs[k]).map((p) => p.role)).toContain(k);
  });
});
