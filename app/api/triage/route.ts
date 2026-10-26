import { runTriage } from "@/lib/agent";

export const maxDuration = 300;

export async function POST() {
  return Response.json({ summary: await runTriage() });
}
