import { serve } from "@hono/node-server";
import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { DATA_DIR, PORT } from "./config.ts";
import { createApp } from "./app.tsx";

await mkdir(DATA_DIR, { recursive: true });
const client = new PGlite(`${DATA_DIR}/when.db`);
const app = await createApp({ client });

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`When Can You Meet http://127.0.0.1:${info.port}`);
  console.log(`MCP Streamable HTTP POST http://127.0.0.1:${info.port}/mcp`);
});
