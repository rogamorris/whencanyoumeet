import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/app.tsx";

const range = {
  startDate: "2026-09-21",
  endDate: "2026-09-21",
  weekdays: [1],
  dailyStart: "09:00",
  dailyEnd: "12:00",
};

describe("http slice", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function app() {
    const client = new PGlite();
    clients.push(client);
    return createApp({ client, publicBaseUrl: "http://127.0.0.1:8080" });
  }

  it("creates, accepts mixed responses, and finalizes with a version check", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Planning",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    expect(created.status).toBe(201);
    const poll = (await created.json()) as {
      publicId: string;
      organizerToken: string;
      eventVersion: number;
      resultsVersion: number;
    };

    const publicHtml = await hono.request(`/p/${poll.publicId}`);
    expect(publicHtml.status).toBe(200);
    expect(await publicHtml.text()).not.toContain(poll.organizerToken);

    const preview = await hono.request(`/p/${poll.publicId}`);
    expect(preview.status).toBe(200);
    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const publicEvent = (await listed.json()) as { respondentCount: number; candidates: Array<{ start: string; end: string }> };
    expect(publicEvent.respondentCount).toBe(0);

    const slot = publicEvent.candidates[0]!;
    const first = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alex",
        remainderUnavailable: true,
        intervals: [{ ...slot, state: "available" }],
      }),
    });
    expect(first.status).toBe(201);

    const second = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alex",
        remainderUnavailable: true,
        intervals: [{ ...slot, state: "unavailable" }],
      }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { responseToken: string; responseVersion: number };

    const organizer = await hono.request(`/api/organizer/${poll.organizerToken}`);
    const results = (await organizer.json()) as {
      resultsVersion: number;
      participants: unknown[];
      language: string;
      tallies: Array<{ start: string; fullSupport: boolean; available: number }>;
    };
    expect(results.participants).toHaveLength(2);
    expect(results.language).toContain("2 respondents");
    expect(results.tallies[0]?.fullSupport).toBe(false);

    const stale = await hono.request(`/api/organizer/${poll.organizerToken}/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        start: slot.start,
        end: slot.end,
        eventVersion: poll.eventVersion,
        resultsVersion: poll.resultsVersion,
      }),
    });
    expect(stale.status).toBe(409);

    const ok = await hono.request(`/api/organizer/${poll.organizerToken}/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        start: slot.start,
        end: slot.end,
        eventVersion: poll.eventVersion,
        resultsVersion: results.resultsVersion,
      }),
    });
    expect(ok.status).toBe(200);

    const after = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam", intervals: [] }),
    });
    expect(after.status).toBe(409);

    const retry = await hono.request(`/api/responses/${secondBody.responseToken}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseVersion: secondBody.responseVersion, intervals: [] }),
    });
    expect(retry.status).toBe(409);
  });

  it("rejects times outside the window and does not mutate on GET", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
      body: JSON.stringify({
        title: "Outside",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { publicId: string };
    const again = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
      body: JSON.stringify({
        title: "Should not create another",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const againBody = (await again.json()) as { publicId: string };
    expect(againBody.publicId).toBe(poll.publicId);

    const bad = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Pat",
        intervals: [
          {
            start: "2026-09-22T13:00:00Z",
            end: "2026-09-22T14:00:00Z",
            state: "available",
          },
        ],
      }),
    });
    expect(bad.status).toBe(400);
  });

  it("lists MCP tools", async () => {
    const hono = await app();
    const response = await hono.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("create_poll");
    expect(text).toContain("submit_availability");
    expect(text).toContain("finalize_poll");
  });
});
