// Runtime configuration discovered from the environment. Presence of a variable is never
// reported as "connected"; see Settings for verified connection state.

export type AppMode = "live" | "demo" | "setup";

export function appMode(): AppMode {
  const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (process.env.DEMO_MODE === "1") {
    // Demo is isolated: refuse to run demo against live credentials.
    if (hasSupabase) throw new Error("DEMO_MODE=1 must not be combined with live Supabase credentials.");
    return "demo";
  }
  return hasSupabase ? "live" : "setup";
}

export function modelConfig(): { model: string; reason: null } | { model: null; reason: string } {
  const model = process.env.AGENT_MODEL?.trim();
  if (!model) return { model: null, reason: "AGENT_MODEL is not set (e.g. a Vercel AI Gateway model id chosen after evaluation)." };
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return { model: null, reason: "No AI Gateway credential (AI_GATEWAY_API_KEY, or Vercel OIDC on a linked deployment)." };
  }
  return { model, reason: null };
}

export function pricing(): { inputPerMTok: number; outputPerMTok: number } | null {
  const i = Number(process.env.AGENT_PRICE_INPUT_PER_MTOK);
  const o = Number(process.env.AGENT_PRICE_OUTPUT_PER_MTOK);
  return Number.isFinite(i) && Number.isFinite(o) && i > 0 && o > 0 ? { inputPerMTok: i, outputPerMTok: o } : null;
}

export const PROJECT_TIMEZONE = "America/Los_Angeles";
