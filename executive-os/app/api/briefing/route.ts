import { runBriefing } from "@/lib/agent";

export const maxDuration = 300;

// GET is the Vercel Cron entry point (weekday mornings, see vercel.json); POST is the dashboard button.
export async function GET() {
  return Response.json({ content: await runBriefing() });
}
export const POST = GET;
