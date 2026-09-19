/** Client script: register page tools if WebMCP is available. Config is server-authored JSON only. */
export function webmcpScript(
  tools: Array<{
    name: string;
    description: string;
    method: "GET" | "POST" | "PATCH";
    path: string;
    inputSchema: Record<string, unknown>;
  }>,
): string {
  return `(() => {
  const tools = ${JSON.stringify(tools)};
  const ctx = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  if (!ctx || typeof ctx.registerTool !== "function") return;
  for (const tool of tools) {
    ctx.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input) => {
        const headers = { Accept: "application/json", "Content-Type": "application/json" };
        const init = { method: tool.method, headers };
        if (tool.method !== "GET") init.body = JSON.stringify(input ?? {});
        const res = await fetch(tool.path, init);
        const data = await res.json();
        if (!res.ok) {
          const message = data?.error?.message || res.statusText;
          throw new Error(message);
        }
        return data;
      }
    });
  }
})();`;
}
