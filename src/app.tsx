import { Hono } from "hono";
import type { Context } from "hono";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as schema from "./db/schema.ts";
import { migrate } from "./db/migrate.ts";
import { createStore } from "./db/store.ts";
import { createCommands } from "./domain/commands.ts";
import { toIcs } from "./domain/ics.ts";
import { DomainError } from "./domain/errors.ts";
import { randomToken } from "./domain/tokens.ts";
import { errorPayload, jsonError, wantsJson } from "./http/errors.ts";
import {
  CreatePage,
  displayTimeZone,
  EditPage,
  ErrorPage,
  InvitationPage,
  OrganizerPage,
  parseSlotFields,
  parseWindowFields,
  ParticipantPage,
} from "./http/pages.tsx";
import {
  createPollSchema,
  finalizeSchema,
  submitSchema,
  updateEventSchema,
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
      return c.json(
        await commands.createPoll({ ...parsed, idempotencyKey: c.req.header("Idempotency-Key") }),
        201,
      );
    } catch (error) {
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
      return c.html(
        <InvitationPage event={event} displayTimeZone={tz} formKey={randomToken()} />,
      );
    }),
  );

  app.post("/p/:publicId/responses", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      const result = await commands.submitAvailability({
        publicId: c.req.param("publicId"),
        name: formString(body.name),
        eventVersion: Number(formString(body.eventVersion)),
        remainderUnavailable: formString(body.remainderUnavailable) === "true",
        intervals: parseSlotFields(body),
        idempotencyKey: formString(body.idempotencyKey) || undefined,
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
        idempotencyKey: c.req.header("Idempotency-Key"),
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
        <ParticipantPage
          event={event}
          responseToken={c.req.param("token")}
          displayTimeZone={tz}
          updateKey={randomToken()}
          withdrawKey={randomToken()}
        />,
      );
    }),
  );

  app.post("/r/:token", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      await commands.updateAvailability({
        responseToken: c.req.param("token"),
        responseVersion: Number(formString(body.responseVersion)),
        eventVersion: Number(formString(body.eventVersion)),
        remainderUnavailable: formString(body.remainderUnavailable) === "true",
        intervals: parseSlotFields(body),
        idempotencyKey: formString(body.idempotencyKey) || undefined,
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
          idempotencyKey: c.req.header("Idempotency-Key"),
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/r/:token/withdraw", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      await commands.withdrawResponse({
        responseToken: c.req.param("token"),
        responseVersion: Number(formString(body.responseVersion)),
        idempotencyKey: formString(body.idempotencyKey) || undefined,
      });
      return c.redirect(`/r/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/responses/:token/withdraw", async (c) => {
    try {
      const parsed = withdrawSchema.parse(await c.req.json());
      return c.json(
        await commands.withdrawResponse({
          responseToken: c.req.param("token"),
          responseVersion: parsed.responseVersion,
          idempotencyKey: c.req.header("Idempotency-Key"),
        }),
      );
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

  app.get("/o/:token/edit", (c) =>
    handle(c, async () => {
      const event = await commands.getOrganizerEvent(c.req.param("token"));
      const tz = displayTimeZone(c.req.query("tz"), event.timezone);
      return c.html(
        <EditPage event={event} organizerToken={c.req.param("token")} displayTimeZone={tz} />,
      );
    }),
  );

  app.post("/o/:token/update", (c) =>
    handle(c, async () => {
      const body = await readForm(c);
      const timezone = formString(body.timezone);
      const tz = displayTimeZone(formString(body.displayTimeZone) || undefined, timezone);
      await commands.updateEvent({
        organizerToken: c.req.param("token"),
        eventVersion: Number(formString(body.eventVersion)),
        title: formString(body.title) || undefined,
        context: formString(body.context),
        location: formString(body.location),
        timezone: timezone || undefined,
        durationMinutes: Number(formString(body.durationMinutes)),
        windows: parseWindowFields(body, tz),
      });
      return c.redirect(`/o/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/organizer/:token/update", async (c) => {
    try {
      const parsed = updateEventSchema.parse(await c.req.json());
      return c.json(await commands.updateEvent({ organizerToken: c.req.param("token"), ...parsed }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/o/:token/reopen", (c) =>
    handle(c, async () => {
      await commands.reopen(c.req.param("token"));
      return c.redirect(`/o/${c.req.param("token")}`, 303);
    }),
  );

  app.post("/api/organizer/:token/reopen", async (c) => {
    try {
      return c.json(await commands.reopen(c.req.param("token")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

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
