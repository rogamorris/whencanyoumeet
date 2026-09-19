import { serve } from "@hono/node-server";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { DATA_DIR, PORT } from "./config.ts";
import { createApp } from "./app.tsx";

await mkdir(DATA_DIR, { recursive: true });
const dataDir = join(DATA_DIR, "when.db");
const client = new PGlite({ dataDir });
await client.waitReady;
const app = await createApp({ client });

const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`When Can You Meet http://127.0.0.1:${info.port}`);
  console.log(`MCP Streamable HTTP POST http://127.0.0.1:${info.port}/mcp`);
  console.log(`PGlite ${dataDir}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: closing database`);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }).catch(() => undefined);
  await client.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
