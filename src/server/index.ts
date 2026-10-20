import { createPool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { buildApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

const db = createPool();
await migrate(db);
const app = await buildApp({ db, webDir: "dist/web", logger: true });
await app.listen({ host, port });
