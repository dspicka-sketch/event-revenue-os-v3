import { Pool } from "pg";
import { PgRunStore } from "../../src/lib/orchestrator/pg-store";
import { Orchestrator } from "../../src/lib/orchestrator/engine";
import { GatewayModelClient } from "../../src/lib/orchestrator/model";

let store: PgRunStore | null = null;

export async function storeForAgent() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  store ??= new PgRunStore(new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));
  return store;
}

export async function orchestratorForAgent() {
  const model = process.env.AGENT_MODEL ? new GatewayModelClient(process.env.AGENT_MODEL) : null;
  return new Orchestrator({ store: await storeForAgent(), model, workerId: `eve-${process.pid}` });
}

export function principal(ctx: { session: { auth?: { current?: { principalId?: string } | null } } }): string {
  const id = ctx.session.auth?.current?.principalId;
  if (!id) throw new Error("No authenticated caller");
  return id;
}
