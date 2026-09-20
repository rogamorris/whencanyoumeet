import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { PORT, PUBLIC_BASE_URL } from "../config.ts";
import { registerMcpTools } from "./tools.ts";
import type { Commands } from "../domain/commands.ts";
import { DomainError } from "../domain/errors.ts";

const base = process.env.WHENCANYOUMEET_URL ?? PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: { code: string; message: string } };
  if (!response.ok) {
    throw new DomainError(
      (data.error?.code as DomainError["code"]) ?? "validation",
      data.error?.message ?? response.statusText,
    );
  }
  return data;
}

const remoteCommands = {
  createPoll: (input) => api("POST", "/api/polls", input),
  getPublicEvent: (publicId) => api("GET", `/api/polls/${publicId}`),
  getParticipantEvent: (token) => api("GET", `/api/responses/${token}`),
  getOrganizerEvent: (token) => api("GET", `/api/organizer/${token}`),
  submitAvailability: (input) => api("POST", `/api/polls/${input.publicId}/responses`, input),
  updateAvailability: (input) => api("PATCH", `/api/responses/${input.responseToken}`, input),
  withdrawResponse: (token, version) =>
    api("POST", `/api/responses/${token}/withdraw`, { responseVersion: version }),
  finalize: (input) => api("POST", `/api/organizer/${input.organizerToken}/finalize`, input),
  updateEvent: (input) => api("POST", `/api/organizer/${input.organizerToken}/update`, input),
  reopen: (token) => api("POST", `/api/organizer/${token}/reopen`),
  cancel: (token) => api("POST", `/api/organizer/${token}/cancel`),
  close: (token) => api("POST", `/api/organizer/${token}/close`),
  deletePoll: (token) => api("POST", `/api/organizer/${token}/delete`),
} satisfies Commands;

serveStdio(() => {
  const server = new McpServer({ name: "whencanyoumeet", version: "0.1.0" });
  registerMcpTools(server, remoteCommands);
  return server;
});
