import { getStore } from "@/lib/store";
import { DEAL_STAGES, type DealStage } from "@/lib/types";

// The dashboard only moves a deal between stages; everything else goes through the assistant.
export async function PATCH(req: Request) {
  const { id, stage } = (await req.json()) as { id?: string; stage?: DealStage };
  if (!id || !stage || !DEAL_STAGES.includes(stage)) return Response.json({ error: "id and a valid stage are required" }, { status: 400 });
  const store = getStore();
  const deal = await store.updateDeal(id, { stage });
  await store.log("sponsor", `Moved ${deal.sponsor} to ${stage}`);
  return Response.json(deal);
}
