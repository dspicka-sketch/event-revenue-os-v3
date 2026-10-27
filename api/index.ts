// Vercel entry point: serves the RevOS API (/api/*) from the same Fastify app
// the standalone server uses. The web client is a static Vite build served by
// Vercel itself (see vercel.json). Migrations are not run here; apply them with
// `npm run db:migrate` before deploying a schema change.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createPool } from "../src/db/pool.js";
import { buildApp } from "../src/server/app.js";

const corsOrigins = (process.env.REVOS_CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const ready = buildApp({ db: createPool(), logger: true, corsOrigins }).then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await ready;
  app.server.emit("request", req, res);
}
