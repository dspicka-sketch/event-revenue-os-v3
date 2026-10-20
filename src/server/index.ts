import { createPool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { buildApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const accessToken = process.env.REVOS_ACCESS_TOKEN || undefined;
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

if (!loopback && !accessToken) {
  console.error("Refusing to listen on a non-loopback address without REVOS_ACCESS_TOKEN set.");
  process.exit(1);
}

const db = createPool();
await migrate(db);
const app = await buildApp({ db, accessToken, webDir: "dist/web", logger: true });
await app.listen({ host, port });
