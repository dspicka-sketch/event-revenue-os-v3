import { listEvents } from "@/lib/calendar";
import { googleConfigured } from "@/lib/google";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// `from`/`to` are the viewer's local day bounds, so "today" matches their time zone.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") ?? new Date().setHours(0, 0, 0, 0));
  const to = new Date(url.searchParams.get("to") ?? +from + 864e5);
  const store = getStore();
  const [tasks, triage, briefing, activity, events] = await Promise.all([
    store.listTasks({ status: "active" }),
    store.listTriage(),
    store.latestBriefing(),
    store.listActivity(15),
    listEvents(from, to),
  ]);
  return Response.json({
    tasks, triage, briefing, activity, events,
    integrations: {
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
      store: store.mode,
      google: googleConfigured(),
    },
  });
}
