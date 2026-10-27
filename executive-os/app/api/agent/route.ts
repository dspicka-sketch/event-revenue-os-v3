import type Anthropic from "@anthropic-ai/sdk";
import { runAssistant } from "@/lib/agent";
import { getStore } from "@/lib/store";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: Anthropic.Beta.BetaMessageParam[] };
  const reply = await runAssistant(messages);
  const last = messages.at(-1);
  if (typeof last?.content === "string") await getStore().log("chat", last.content.slice(0, 120));
  return Response.json({ reply });
}
