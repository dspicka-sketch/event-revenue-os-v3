import { defineTool } from "eve/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { orchestratorForAgent, principal } from "../lib/runtime";

export default defineTool({
  description:
    "Start a durable investigation or chief-of-staff brief. The application selects relevant specialists, validates their output against the evidence register, and stores proposals for human review. Returns a run id.",
  inputSchema: z.object({
    project_id: z.string().uuid(),
    question: z.string().min(3).max(2000),
    kind: z.enum(["brief", "investigation"]).default("investigation"),
  }),
  async execute({ project_id, question, kind }, ctx) {
    const o = await orchestratorForAgent();
    const key = `eve-${ctx.session.id ?? "s"}-${ctx.callId}`.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80) || randomUUID();
    const { run } = await o.startRun({ projectId: project_id, userId: principal(ctx), kind, question, idempotencyKey: key });
    void o.execute(run.id); // the cron worker resumes it if this process stops
    return { run_id: run.id, state: run.state, specialists: run.planned_roles, dashboard: `/runs/${run.id}` };
  },
});
