import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { PORT, PUBLIC_BASE_URL } from "../config.ts";
import { registerMcpTools } from "./tools.ts";
import type { Commands } from "../domain/commands.ts";
import { DomainError } from "../domain/errors.ts";

const base = process.env.WHENCANYOUMEET_URL ?? PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`;

function splitKey<T extends { idempotencyKey?: string }>(input: T): {
  idempotencyKey?: string;
  body: Omit<T, "idempotencyKey">;
} {
  const { idempotencyKey, ...body } = input;
  return { idempotencyKey, body };
}

async function api<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
  createPoll: (input) => {
    const { idempotencyKey, body } = splitKey(input);
    return api("POST", "/api/polls", body, idempotencyKey);
  },
  getPublicEvent: (publicId) => api("GET", `/api/polls/${publicId}`),
  getParticipantEvent: (token) => api("GET", `/api/responses/${token}`),
  getOrganizerEvent: (token) => api("GET", `/api/organizer/${token}`),
  submitAvailability: (input) => {
    const { idempotencyKey, body } = splitKey(input);
    return api("POST", `/api/polls/${input.publicId}/responses`, body, idempotencyKey);
  },
  updateAvailability: (input) => {
    const { idempotencyKey, body } = splitKey(input);
    return api("PATCH", `/api/responses/${input.responseToken}`, body, idempotencyKey);
  },
  withdrawResponse: (input) => {
    const { idempotencyKey } = splitKey(input);
    return api(
      "POST",
      `/api/responses/${input.responseToken}/withdraw`,
      { responseVersion: input.responseVersion },
      idempotencyKey,
    );
  },
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
