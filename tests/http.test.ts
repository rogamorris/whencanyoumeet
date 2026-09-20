import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/app.tsx";
import { upcomingWeekdayRange } from "../src/domain/windows.ts";

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
        eventVersion: poll.eventVersion,
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
        eventVersion: poll.eventVersion,
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
      body: JSON.stringify({ name: "Sam", eventVersion: poll.eventVersion, intervals: [] }),
    });
    expect(after.status).toBe(409);

    const retry = await hono.request(`/api/responses/${secondBody.responseToken}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        responseVersion: secondBody.responseVersion,
        eventVersion: poll.eventVersion,
        intervals: [],
      }),
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
    const poll = (await created.json()) as {
      publicId: string;
      organizerToken: string;
      eventVersion: number;
    };
    const replay = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
      body: JSON.stringify({
        title: "Outside",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    expect(replay.status).toBe(201);
    const replayBody = (await replay.json()) as { publicId: string; organizerToken: string };
    expect(replayBody.publicId).toBe(poll.publicId);
    expect(replayBody.organizerToken).toBe(poll.organizerToken);

    const reordered = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
      body: JSON.stringify({
        range,
        timezone: "America/New_York",
        durationMinutes: 60,
        title: "Outside",
      }),
    });
    expect(reordered.status).toBe(201);
    const reorderedBody = (await reordered.json()) as { organizerToken: string };
    expect(reorderedBody.organizerToken).toBe(poll.organizerToken);

    const clash = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
      body: JSON.stringify({
        title: "Should not mint the first organizer token",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    expect(clash.status).toBe(409);
    const clashText = await clash.text();
    expect(clashText).not.toContain(poll.organizerToken);
    const clashBody = JSON.parse(clashText) as { error?: { code: string }; organizerToken?: string };
    expect(clashBody.error?.code).toBe("conflict");
    expect(clashBody.organizerToken).toBeUndefined();

    const bad = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Pat",
        eventVersion: poll.eventVersion,
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

  it("prefills ISO weekday dates on the create form", async () => {
    const hono = await app();
    const page = await hono.request("/");
    expect(page.status).toBe(200);
    const html = await page.text();
    const range = upcomingWeekdayRange("America/New_York");
    expect(html).toContain(`value="${range.startDate}"`);
    expect(html).toContain(`value="${range.endDate}"`);
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('type="time"');
  });

  it("keeps every checked weekday from the HTML form", async () => {
    const hono = await app();
    const created = await hono.request("/polls", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["title", "Full week"],
        ["durationMinutes", "60"],
        ["timezone", "America/New_York"],
        ["startDate", "2026-09-21"],
        ["endDate", "2026-09-25"],
        ["weekday", "1"],
        ["weekday", "2"],
        ["weekday", "3"],
        ["weekday", "4"],
        ["weekday", "5"],
        ["dailyStart", "09:00"],
        ["dailyEnd", "10:00"],
      ]),
    });
    expect(created.status).toBe(303);
    const organizerToken = created.headers.get("location")!.split("/o/")[1]!;
    const organizer = await hono.request(`/api/organizer/${organizerToken}`);
    const body = (await organizer.json()) as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(5);
  });

  it("creates, answers, and finalizes through HTML with 303 redirects", async () => {
    const hono = await app();
    const created = await hono.request("/polls", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        title: "HTML loop",
        durationMinutes: "60",
        timezone: "America/New_York",
        startDate: "2026-09-21",
        endDate: "2026-09-21",
        weekday: "1",
        dailyStart: "09:00",
        dailyEnd: "12:00",
      }),
    });
    expect(created.status).toBe(303);
    const organizerUrl = created.headers.get("location");
    expect(organizerUrl).toMatch(/\/o\/.+/);
    const organizerToken = organizerUrl!.split("/o/")[1]!;

    const organizerPage = await hono.request(`/o/${organizerToken}`);
    expect(organizerPage.status).toBe(200);
    const organizerHtml = await organizerPage.text();
    expect(organizerHtml).toContain("/p/");
    expect(organizerHtml).toContain("HTML loop");

    const listed = await hono.request(`/api/organizer/${organizerToken}`);
    const results = (await listed.json()) as {
      publicId: string;
      eventVersion: number;
      resultsVersion: number;
      candidates: Array<{ start: string; end: string }>;
    };
    const slot = results.candidates[0]!;
    const answered = await hono.request(`/p/${results.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Alex",
        eventVersion: String(results.eventVersion),
        remainderUnavailable: "true",
        [`slot:${slot.start}|${slot.end}`]: "available",
      }),
    });
    expect(answered.status).toBe(303);
    expect(answered.headers.get("location")).toMatch(/\/r\/.+/);

    const afterAnswer = await hono.request(`/api/organizer/${organizerToken}`);
    const tallied = (await afterAnswer.json()) as {
      eventVersion: number;
      resultsVersion: number;
      participants: unknown[];
    };
    expect(tallied.participants).toHaveLength(1);

    const finalized = await hono.request(`/o/${organizerToken}/finalize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        start: slot.start,
        end: slot.end,
        eventVersion: String(tallied.eventVersion),
        resultsVersion: String(tallied.resultsVersion),
      }),
    });
    expect(finalized.status).toBe(303);
    expect(finalized.headers.get("location")).toMatch(/\/o\/.+/);

    const publicPage = await hono.request(`/p/${results.publicId}`);
    const publicHtml = await publicPage.text();
    expect(publicHtml).toContain("Chosen time:");
    expect(publicHtml).not.toContain(organizerToken);
  });

  it("reopens a poll from a PGlite data directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "when-"));
    try {
      const first = new PGlite({ dataDir: dir });
      clients.push(first);
      const app1 = await createApp({ client: first, publicBaseUrl: "http://127.0.0.1:8080" });
      const created = await app1.request("/api/polls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Persisted",
          durationMinutes: 60,
          timezone: "America/New_York",
          range,
        }),
      });
      const poll = (await created.json()) as { publicId: string };
      await first.close();
      clients.splice(clients.indexOf(first), 1);

      const second = new PGlite({ dataDir: dir });
      clients.push(second);
      const app2 = await createApp({ client: second, publicBaseUrl: "http://127.0.0.1:8080" });
      const got = await app2.request(`/api/polls/${poll.publicId}`);
      expect(got.status).toBe(200);
      const body = (await got.json()) as { title: string };
      expect(body.title).toBe("Persisted");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
    expect(text).toContain("close_poll");
    expect(text).toContain("delete_poll");
    expect(text).toContain("update_event");
    expect(text).toContain("reopen_poll");
  });

  it("redirects HTML withdraw onto the response URL", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Withdraw",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { publicId: string };
    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const publicEvent = (await listed.json()) as { candidates: Array<{ start: string; end: string }> };
    const slot = publicEvent.candidates[0]!;
    const answered = await hono.request(`/p/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Alex",
        eventVersion: "1",
        remainderUnavailable: "true",
        [`slot:${slot.start}|${slot.end}`]: "available",
      }),
    });
    expect(answered.status).toBe(303);
    const responseUrl = answered.headers.get("location")!;
    const responseToken = responseUrl.split("/r/")[1]!;
    const page = await hono.request(`/r/${responseToken}`);
    const html = await page.text();
    const version = html.match(/name="responseVersion" value="(\d+)"/)?.[1];
    expect(version).toBe("1");

    const withdrawn = await hono.request(`/r/${responseToken}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ responseVersion: version! }),
    });
    expect(withdrawn.status).toBe(303);
    expect(withdrawn.headers.get("location")).toMatch(new RegExp(`/r/${responseToken}$`));
    expect(await withdrawn.text()).not.toContain("Could not complete that");

    const after = await hono.request(`/r/${responseToken}`);
    expect(await after.text()).toContain("This response is withdrawn.");
  });

  it("closes and deletes on JSON and the organizer HTML page", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Lifecycle",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { publicId: string; organizerToken: string };
    const closed = await hono.request(`/api/organizer/${poll.organizerToken}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ receipt: "Collection closed without choosing a time." });

    const closedAgain = await hono.request(`/api/organizer/${poll.organizerToken}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(closedAgain.status).toBe(200);
    expect(await closedAgain.json()).toEqual({ receipt: "Collection closed without choosing a time." });

    const late = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam", eventVersion: 1, intervals: [] }),
    });
    expect(late.status).toBe(409);

    const deleted = await hono.request(`/api/organizer/${poll.organizerToken}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ receipt: "Poll deleted." });
    const gone = await hono.request(`/api/organizer/${poll.organizerToken}`);
    expect(gone.status).toBe(404);
    expect((await hono.request(`/api/polls/${poll.publicId}`)).status).toBe(404);

    const closedAfterDelete = await hono.request(`/api/organizer/${poll.organizerToken}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(closedAfterDelete.status).toBe(404);

    const other = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "HTML delete",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const htmlPoll = (await other.json()) as { organizerToken: string };
    const organizerPage = await hono.request(`/o/${htmlPoll.organizerToken}`);
    const organizerHtml = await organizerPage.text();
    expect(organizerHtml).toContain(`/o/${htmlPoll.organizerToken}/close`);
    expect(organizerHtml).toContain(`/o/${htmlPoll.organizerToken}/delete`);

    const htmlDeleted = await hono.request(`/o/${htmlPoll.organizerToken}/delete`, { method: "POST" });
    expect(htmlDeleted.status).toBe(303);
    expect(htmlDeleted.headers.get("location")).toMatch(/\/$/);
  });

  it("returns 400 validation when a JSON update body fails the schema", async () => {
    const hono = await app();
    const invalid = await hono.request("/api/responses/not-a-token", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseVersion: "1" }),
    });
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as {
      error: { code: string; message: string; details: Array<{ path: Array<string | number> }> };
    };
    expect(body.error.code).toBe("validation");
    expect(body.error.message).toContain("responseVersion");
    expect(body.error.details.some((issue) => issue.path.includes("responseVersion"))).toBe(true);
  });

  it("creates a new poll when the Idempotency-Key's original poll was deleted", async () => {
    const hono = await app();
    const payload = {
      title: "Reusable key",
      durationMinutes: 60,
      timezone: "America/New_York",
      range,
    };
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "after-delete" },
      body: JSON.stringify(payload),
    });
    const poll = (await created.json()) as { publicId: string; organizerToken: string };
    expect(
      (await hono.request(`/api/organizer/${poll.organizerToken}/delete`, { method: "POST" })).status,
    ).toBe(200);

    const again = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "after-delete" },
      body: JSON.stringify(payload),
    });
    expect(again.status).toBe(201);
    const revived = (await again.json()) as { publicId: string; organizerToken: string };
    expect(revived.organizerToken).not.toBe(poll.organizerToken);
    expect(revived.publicId).not.toBe(poll.publicId);
    expect((await hono.request(`/api/organizer/${revived.organizerToken}`)).status).toBe(200);
    expect((await hono.request(`/api/organizer/${poll.organizerToken}`)).status).toBe(404);
  });

  it("creates, submits, and finalizes through MCP tools/call", async () => {
    const hono = await app();
    const mcpHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    const createdRpc = await hono.request("/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_poll",
          arguments: {
            title: "MCP loop",
            durationMinutes: 60,
            timezone: "America/New_York",
            range,
          },
        },
      }),
    });
    expect(createdRpc.status).toBe(200);
    const created = mcpStructured<{
      publicId: string;
      organizerToken: string;
      eventVersion: number;
      resultsVersion: number;
    }>(await createdRpc.text());
    expect(created.publicId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.organizerToken.length).toBeGreaterThan(20);

    const submittedRpc = await hono.request("/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "submit_availability",
          arguments: {
            publicId: created.publicId,
            name: "Alex",
            eventVersion: created.eventVersion,
            remainderUnavailable: true,
            intervals: [
              {
                start: "2026-09-21T13:00:00Z",
                end: "2026-09-21T14:00:00Z",
                state: "available",
              },
            ],
          },
        },
      }),
    });
    expect(submittedRpc.status).toBe(200);
    const submitted = mcpStructured<{ responseToken: string; responseVersion: number }>(
      await submittedRpc.text(),
    );
    expect(submitted.responseVersion).toBe(1);
    expect(submitted.responseToken.length).toBeGreaterThan(20);

    const results = (await (
      await hono.request(`/api/organizer/${created.organizerToken}`)
    ).json()) as { resultsVersion: number };

    const finalizedRpc = await hono.request("/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "finalize_poll",
          arguments: {
            organizerToken: created.organizerToken,
            start: "2026-09-21T13:00:00Z",
            end: "2026-09-21T14:00:00Z",
            eventVersion: created.eventVersion,
            resultsVersion: results.resultsVersion,
          },
        },
      }),
    });
    expect(finalizedRpc.status).toBe(200);
    const finalized = mcpStructured<{ receipt: string; icsUrl: string }>(await finalizedRpc.text());
    expect(finalized.receipt).toContain("Recorded a decision");
    expect(finalized.icsUrl).toContain(`/o/${created.organizerToken}/event.ics`);

    const publicEvent = (await (await hono.request(`/api/polls/${created.publicId}`)).json()) as {
      status: string;
      finalized?: { start: string; end: string };
    };
    expect(publicEvent.status).toBe("finalized");
    expect(publicEvent.finalized).toEqual({
      start: "2026-09-21T13:00:00Z",
      end: "2026-09-21T14:00:00Z",
    });
  });

  it("reopens a closed poll so collection can continue", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Reopen me",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { publicId: string; organizerToken: string };
    expect(
      (await hono.request(`/api/organizer/${poll.organizerToken}/close`, { method: "POST" })).status,
    ).toBe(200);

    const organizerPage = await hono.request(`/o/${poll.organizerToken}`);
    expect(await organizerPage.text()).toContain(`/o/${poll.organizerToken}/reopen`);

    const reopened = await hono.request(`/api/organizer/${poll.organizerToken}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toEqual({
      receipt: "Collection reopened. Participants can answer again.",
    });

    const again = await hono.request(`/api/organizer/${poll.organizerToken}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(again.status).toBe(200);

    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const publicEvent = (await listed.json()) as {
      status: string;
      candidates: Array<{ start: string; end: string }>;
    };
    expect(publicEvent.status).toBe("open");
    const slot = publicEvent.candidates[0]!;
    const submitted = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alex",
        eventVersion: 1,
        remainderUnavailable: true,
        intervals: [{ ...slot, state: "available" }],
      }),
    });
    expect(submitted.status).toBe(201);
  });

  it("keeps remainder unknown on windows added after the response", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Widen",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as {
      publicId: string;
      organizerToken: string;
      eventVersion: number;
    };
    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const event = (await listed.json()) as {
      windows: Array<{ start: string; end: string }>;
      candidates: Array<{ start: string; end: string }>;
    };
    const slot = event.candidates[0]!;
    expect(
      (
        await hono.request(`/api/polls/${poll.publicId}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Alex",
            eventVersion: poll.eventVersion,
            remainderUnavailable: true,
            intervals: [{ ...slot, state: "available" }],
          }),
        })
      ).status,
    ).toBe(201);

    const extra = { start: "2026-09-22T13:00:00Z", end: "2026-09-22T16:00:00Z" };
    const updated = await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventVersion: poll.eventVersion,
        windows: [...event.windows, extra],
      }),
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { eventVersion: number; constraintsChanged: boolean };
    expect(body.eventVersion).toBe(2);
    expect(body.constraintsChanged).toBe(true);

    const organizer = (await (
      await hono.request(`/api/organizer/${poll.organizerToken}`)
    ).json()) as {
      eventVersion: number;
      tallies: Array<{ start: string; available: number; unknown: number; unavailable: number }>;
    };
    expect(organizer.eventVersion).toBe(2);
    const original = organizer.tallies.find((row) => row.start === slot.start);
    expect(original).toEqual(expect.objectContaining({ available: 1, unknown: 0, unavailable: 0 }));
    const added = organizer.tallies.find((row) => row.start.startsWith("2026-09-22"));
    expect(added).toEqual(expect.objectContaining({ available: 0, unknown: 1, unavailable: 0 }));
  });

  it("does not inherit a yes onto a shorter duration", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Shorter",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as {
      publicId: string;
      organizerToken: string;
      eventVersion: number;
    };
    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const event = (await listed.json()) as { candidates: Array<{ start: string; end: string }> };
    expect(
      (
        await hono.request(`/api/polls/${poll.publicId}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Alex",
            eventVersion: poll.eventVersion,
            intervals: [{ ...event.candidates[0]!, state: "available" }],
          }),
        })
      ).status,
    ).toBe(201);

    const updated = await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventVersion: poll.eventVersion, durationMinutes: 30 }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(
      expect.objectContaining({ eventVersion: 2, constraintsChanged: true }),
    );

    const organizer = (await (
      await hono.request(`/api/organizer/${poll.organizerToken}`)
    ).json()) as {
      durationMinutes: number;
      tallies: Array<{ available: number; unknown: number; fullSupport: boolean }>;
    };
    expect(organizer.durationMinutes).toBe(30);
    expect(organizer.tallies.length).toBeGreaterThan(0);
    expect(organizer.tallies.every((row) => row.available === 0 && row.unknown === 1)).toBe(true);
    expect(organizer.tallies.every((row) => row.fullSupport === false)).toBe(true);
  });

  it("rejects a JSON submit that omits eventVersion", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Versioned submit",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { publicId: string };
    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const event = (await listed.json()) as { candidates: Array<{ start: string; end: string }> };
    const missing = await hono.request(`/api/polls/${poll.publicId}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alex",
        intervals: [{ ...event.candidates[0]!, state: "available" }],
      }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "validation" }) }),
    );
  });

  it("edits title only and leaves eventVersion untouched", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Old title",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { organizerToken: string; eventVersion: number };
    const updated = await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventVersion: poll.eventVersion, title: "New title" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(
      expect.objectContaining({ eventVersion: 1, constraintsChanged: false }),
    );
    const organizer = (await (await hono.request(`/api/organizer/${poll.organizerToken}`)).json()) as {
      title: string;
      eventVersion: number;
    };
    expect(organizer.title).toBe("New title");
    expect(organizer.eventVersion).toBe(1);
  });

  it("keeps a closed poll closed after an edit", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Closed edit",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { organizerToken: string; eventVersion: number };
    expect(
      (await hono.request(`/api/organizer/${poll.organizerToken}/close`, { method: "POST" })).status,
    ).toBe(200);
    const updated = await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventVersion: poll.eventVersion, title: "Still closed" }),
    });
    expect(updated.status).toBe(200);
    const organizer = (await (await hono.request(`/api/organizer/${poll.organizerToken}`)).json()) as {
      status: string;
      title: string;
    };
    expect(organizer.status).toBe("closed");
    expect(organizer.title).toBe("Still closed");
  });

  it("reopens a cancelled poll and refuses a finalized poll", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Cancel then reopen",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as { organizerToken: string };
    expect(
      (await hono.request(`/api/organizer/${poll.organizerToken}/cancel`, { method: "POST" })).status,
    ).toBe(200);
    const reopened = await hono.request(`/api/organizer/${poll.organizerToken}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(reopened.status).toBe(200);
    expect(
      ((await (await hono.request(`/api/organizer/${poll.organizerToken}`)).json()) as { status: string }).status,
    ).toBe("open");

    const other = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Finalized",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const decided = (await other.json()) as {
      publicId: string;
      organizerToken: string;
      eventVersion: number;
    };
    const listed = await hono.request(`/api/polls/${decided.publicId}`);
    const slot = ((await listed.json()) as { candidates: Array<{ start: string; end: string }> }).candidates[0]!;
    expect(
      (
        await hono.request(`/api/organizer/${decided.organizerToken}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            start: slot.start,
            end: slot.end,
            eventVersion: decided.eventVersion,
            resultsVersion: 1,
          }),
        })
      ).status,
    ).toBe(200);
    const refused = await hono.request(`/api/organizer/${decided.organizerToken}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "closed",
          message: "A finalized poll cannot be reopened. Delete it and create a new poll.",
        }),
      }),
    );
  });

  it("rejects a stale eventVersion on update and a duration that fits no window", async () => {
    const hono = await app();
    const created = await hono.request("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Stale edit",
        durationMinutes: 60,
        timezone: "America/New_York",
        range,
      }),
    });
    const poll = (await created.json()) as {
      publicId: string;
      organizerToken: string;
      eventVersion: number;
    };
    const listed = await hono.request(`/api/polls/${poll.publicId}`);
    const event = (await listed.json()) as { windows: Array<{ start: string; end: string }> };
    expect(
      (
        await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventVersion: poll.eventVersion,
            windows: [...event.windows, { start: "2026-09-22T13:00:00Z", end: "2026-09-22T16:00:00Z" }],
          }),
        })
      ).status,
    ).toBe(200);
    const stale = await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventVersion: poll.eventVersion, title: "Should not land" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "stale_version" }) }),
    );
    const tooLong = await hono.request(`/api/organizer/${poll.organizerToken}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventVersion: 2, durationMinutes: 240 }),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "validation" }) }),
    );
    const organizer = (await (await hono.request(`/api/organizer/${poll.organizerToken}`)).json()) as {
      title: string;
      durationMinutes: number;
      eventVersion: number;
    };
    expect(organizer.title).toBe("Stale edit");
    expect(organizer.durationMinutes).toBe(60);
    expect(organizer.eventVersion).toBe(2);
  });
});

function mcpStructured<T>(sse: string): T {
  const line = sse.split("\n").find((row) => row.startsWith("data: "));
  expect(line, "MCP SSE data line").toBeTruthy();
  const message = JSON.parse(line!.slice(6)) as {
    error?: unknown;
    result?: { structuredContent?: T; isError?: boolean };
  };
  expect(message.error).toBeUndefined();
  expect(message.result?.isError).not.toBe(true);
  expect(message.result?.structuredContent).toEqual(expect.any(Object));
  return message.result!.structuredContent as T;
}
