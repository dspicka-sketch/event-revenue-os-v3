import { getStore } from "@/lib/store";
import type { Task } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Task> & { title: string };
  return Response.json(await getStore().createTask({ ...body, source: "manual" }));
}

export async function PATCH(req: Request) {
  const { id, ...patch } = (await req.json()) as Partial<Task> & { id: string };
  return Response.json(await getStore().updateTask(id, patch));
}
