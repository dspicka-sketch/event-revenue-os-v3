import { defineAgent } from "eve";

// Chief-of-staff conversational front door. Project records in Supabase are authoritative;
// durable specialist execution runs in the application's Postgres-checkpointed orchestrator.
// The model id is configuration (AGENT_MODEL), chosen after evaluation — not hardcoded.
export default defineAgent({
  model: process.env.AGENT_MODEL ?? "set-AGENT_MODEL",
  defaultTools: false, // no shell, file, or web tools
  tool: false, // no recursive copies of itself
});
