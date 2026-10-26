import { defineTool } from "eve/tools";
import { z } from "zod";
import { principal, storeForAgent } from "../lib/runtime";

export default defineTool({
  description: "Read a run's state and its reconciled brief (next actions, conflicts, evidence ids, partial failures).",
  inputSchema: z.object({ run_id: z.string().uuid() }),
  async execute({ run_id }, ctx) {
    const store = await storeForAgent();
    const run = await store.getRun(run_id);
    if (!run) return { error: "not found" };
    if (!(await store.getMemberRole(run.project_id, principal(ctx)))) return { error: "not authorized" };
    return { state: run.state, live: run.live, brief: run.brief, usage: run.usage };
  },
});
