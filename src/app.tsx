import { Hono } from "hono";
import type { Context } from "hono";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as schema from "./db/schema.ts";
import { migrate } from "./db/migrate.ts";
import { createStore } from "./db/store.ts";
import { createCommands } from "./domain/commands.ts";
import { toIcs } from "./domain/ics.ts";
import { DomainError } from "./domain/errors.ts";
import { errorPayload, jsonError, wantsJson } from "./http/errors.ts";
import type { CreatePollResult } from "./domain/types.ts";
import { parseIdempotencyRecord, requestHash } from "./http/idempotency.ts";
import {
  CreatePage,
  displayTimeZone,
  ErrorPage,
  InvitationPage,
  OrganizerPage,
  parseSlotFields,
  ParticipantPage,
} from "./http/pages.tsx";
import {
  createPollSchema,
  finalizeSchema,
  submitSchema,
  updateSchema,
  withdrawSchema,
} from "./http/schemas.ts";
import { registerMcpTools } from "./mcp/tools.ts";
import { openApiDocument } from "./http/openapi.ts";
import { PUBLIC_BASE_URL } from "./config.ts";
import { upcomingWeekdayRange } from "./domain/windows.ts";

async function readForm(c: Context) {
  return c.req.parseBody({ all: true });
}

function formString(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function formList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

function htmlError(c: Context, error: unknown) {
  const { status, body } = errorPayload(error);
  return c.html(<ErrorPage message={body.error.message} status={status} />, status as 400);
}

async function handle(c: Context, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (wantsJson(c) && !c.req.header("accept")?.includes("text/html")) {
      return jsonError(c, error);
    }
    return htmlError(c, error);
  }
}

export async function createApp(options?: {
  client?: PGlite;
  publicBaseUrl?: string;
}): Promise<Hono> {
  const client = options?.client ?? new PGlite();
  await migrate(client);
  const db = drizzle({ client, schema });
  const store = createStore(db);
  const commands = createCommands(store, options?.publicBaseUrl ?? PUBLIC_BASE_URL);

  const mcpHandler = createMcpHandler(() => {
    const server = new McpServer({ name: "whencanyoumeet", version: "0.1.0" });
    registerMcpTools(server, commands);
    return server;
  });

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.use("/o/*", async (c, next) => {
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/r/*", async (c, next) => {
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/openapi.json", (c) => c.json(openApiDocument(options?.publicBaseUrl ?? PUBLIC_BASE_URL)));
  app.get("/llms.txt", (c) =>
    c.text(`# When Can You Meet

A group scheduling poll. Humans and agents operate the same event.

This service does not read calendars and does not run a language model.
A response is availability, not a hold, booking, or delivered invitation.

## Surfaces
- Manual UI: GET /
- Public poll: GET /p/{publicId} (JSON if Accept: application/json)
- HTTP API: see /openapi.json
- MCP Streamable HTTP: POST /mcp

## Writes
Mutations require a capability token (organizer or response). GET, HEAD, and link previews never vote, withdraw, finalize, or delete.
Do not send calendar event titles, busy reasons, or raw calendar exports.
`),
  );

  app.get("/", (c) => {
    const timezone = "America/New_York";
    return c.html(<CreatePage timezone={timezone} range={upcomingWeekdayRange(timezone)} />);
  });

  app.post("/polls", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      const created = await commands.createPoll({
        title: formString(body.title),
        context: formString(body.context) || undefined,
        durationMinutes: Number(formString(body.durationMinutes)),
        timezone: formString(body.timezone),
        range: {
          startDate: formString(body.startDate),
          endDate: formString(body.endDate),
          weekdays: formList(body.weekday).map(Number),
          dailyStart: formString(body.dailyStart),
          dailyEnd: formString(body.dailyEnd),
        },
      });
      return c.redirect(created.organizerUrl, 303);
    }),
  );

  app.post("/api/polls", async (c) => {
    try {
      const parsed = createPollSchema.parse(await c.req.json());
      const idem = c.req.header("Idempotency-Key");
      if (idem) {
        const key = `create:${idem}`;
        const hash = requestHash(parsed);
        const existing = await store.getIdempotency(key);
        if (existing) {
          const record = parseIdempotencyRecord<CreatePollResult>(existing);
          if (record && record.requestHash === hash) {
            return c.json(record.result, 201);
          }
          throw new DomainError(
            "conflict",
            "Idempotency-Key already used with a different request.",
          );
        }
        const created = await commands.createPoll(parsed);
        await store.saveIdempotency(key, JSON.stringify({ requestHash: hash, result: created }));
        return c.json(created, 201);
      }
      return c.json(await commands.createPoll(parsed), 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: { code: "validation", message: error.message } }, 400);
      }
      return jsonError(c, error);
    }
  });

  app.get("/api/polls/:publicId", async (c) => {
    try {
      return c.json(await commands.getPublicEvent(c.req.param("publicId")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/p/:publicId", (c) =>
    handle(c, async () => {
      if (prefersJson(c)) {
        return c.json(await commands.getPublicEvent(c.req.param("publicId")));
      }
      const event = await commands.getPublicEvent(c.req.param("publicId"));
      const tz = displayTimeZone(c.req.query("tz"), event.timezone);
      return c.html(<InvitationPage event={event} displayTimeZone={tz} />);
    }),
  );

  app.post("/p/:publicId/responses", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      const result = await commands.submitAvailability({
        publicId: c.req.param("publicId"),
        name: formString(body.name),
        remainderUnavailable: formString(body.remainderUnavailable) === "true",
        intervals: parseSlotFields(body),
      });
      return c.redirect(result.responseUrl, 303);
    }),
  );

  app.post("/api/polls/:publicId/responses", async (c) => {
    try {
      const parsed = submitSchema.parse(await c.req.json());
      const result = await commands.submitAvailability({
        publicId: c.req.param("publicId"),
        ...parsed,
      });
      return c.json(result, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/responses/:token", async (c) => {
    try {
      return c.json(await commands.getParticipantEvent(c.req.param("token")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/r/:token", (c) =>
    handle(c, async () => {
      const event = await commands.getParticipantEvent(c.req.param("token"));
      const tz = displayTimeZone(c.req.query("tz"), event.timezone);
      return c.html(
        <ParticipantPage event={event} responseToken={c.req.param("token")} displayTimeZone={tz} />,
      );
    }),
  );

  app.post("/r/:token", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      await commands.updateAvailability({
        responseToken: c.req.param("token"),
        responseVersion: Number(formString(body.responseVersion)),
        remainderUnavailable: formString(body.remainderUnavailable) === "true",
        intervals: parseSlotFields(body),
      });
      return c.redirect(`/r/${c.req.param("token")}`, 303);
    }),
  );

  app.patch("/api/responses/:token", async (c) => {
    try {
      const parsed = updateSchema.parse(await c.req.json());
      return c.json(
        await commands.updateAvailability({
          responseToken: c.req.param("token"),
          ...parsed,
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/r/:token/withdraw", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      await commands.withdrawResponse(
        c.req.param("token"),
        Number(formString(body.responseVersion)),
      );
      return c.redirect(`/r/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/responses/:token/withdraw", async (c) => {
    try {
      const parsed = withdrawSchema.parse(await c.req.json());
      return c.json(await commands.withdrawResponse(c.req.param("token"), parsed.responseVersion));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/organizer/:token", async (c) => {
    try {
      return c.json(await commands.getOrganizerEvent(c.req.param("token")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/o/:token", (c) =>
    handle(c, async () => {
      const event = await commands.getOrganizerEvent(c.req.param("token"));
      const tz = displayTimeZone(c.req.query("tz"), event.timezone);
      return c.html(
        <OrganizerPage event={event} organizerToken={c.req.param("token")} displayTimeZone={tz} />,
      );
    }),
  );

  app.post("/o/:token/finalize", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      await commands.finalize({
        organizerToken: c.req.param("token"),
        start: formString(body.start),
        end: formString(body.end),
        eventVersion: Number(formString(body.eventVersion)),
        resultsVersion: Number(formString(body.resultsVersion)),
      });
      return c.redirect(`/o/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/organizer/:token/finalize", async (c) => {
    try {
      const parsed = finalizeSchema.parse(await c.req.json());
      return c.json(await commands.finalize({ organizerToken: c.req.param("token"), ...parsed }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/o/:token/cancel", (c) =>
    handle(c, async () => {
      await commands.cancel(c.req.param("token"));
      return c.redirect(`/o/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/organizer/:token/cancel", async (c) => {
    try {
      return c.json(await commands.cancel(c.req.param("token")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/o/:token/close", (c) =>
    handle(c, async () => {
      await commands.close(c.req.param("token"));
      return c.redirect(`/o/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/organizer/:token/close", async (c) => {
    try {
      return c.json(await commands.close(c.req.param("token")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/o/:token/delete", (c) =>
    handle(c, async () => {
      await commands.deletePoll(c.req.param("token"));
      return c.redirect("/", 303);
    }),
  );

  app.post("/api/organizer/:token/delete", async (c) => {
    try {
      return c.json(await commands.deletePoll(c.req.param("token")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/o/:token/event.ics", (c) =>
    handle(c, async () => {
      const event = await commands.getOrganizerEvent(c.req.param("token"));
      if (!event.finalized) {
        throw new DomainError("closed", "No calendar file until the poll is finalized.");
      }
      const ics = toIcs({
        title: event.title,
        start: event.finalized.start,
        end: event.finalized.end,
        location: event.location,
      });
      return new Response(ics, {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'attachment; filename="meeting.ics"',
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }),
  );

  app.all("/mcp", async (c) => {
    let parsedBody: unknown;
    const contentType = c.req.header("content-type") ?? "";
    if (c.req.method === "POST" && contentType.includes("application/json")) {
      parsedBody = await c.req.json();
    }
    return mcpHandler.fetch(c.req.raw, { parsedBody });
  });

  return app;
}

function prefersJson(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/html")) return false;
  return accept.includes("application/json");
}
