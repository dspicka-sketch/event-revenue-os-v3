import { gmailConfigured } from "@/lib/gmail";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const [tasks, triage, briefing, activity] = await Promise.all([
    store.listTasks({ status: "active" }),
    store.listTriage(),
    store.latestBriefing(),
    store.listActivity(15),
  ]);
  return Response.json({
    tasks, triage, briefing, activity,
    integrations: {
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
      store: store.mode,
      gmail: gmailConfigured(),
    },
  });
}
