# How to edit a poll and reopen collection

Call `commands.updateEvent` and `commands.reopen`. Every adapter posts to those two methods. JSON, HTML, WebMCP, MCP over HTTP, MCP over stdio, and OpenAPI do not invent their own invalidation rules.

`updateEvent` is a versioned organizer write, like `finalize`. The client sends `eventVersion`. `reopen` is a token-only organizer write, like `close`.

## Rules you can rely on

1. Reopen is allowed from `closed` and from `cancelled`. `finalized` stays terminal. An already-open reopen returns the same receipt and writes nothing.
2. A constraint edit replaces the whole window set. Send `windows` or `range`, not a window to append. `RangeSpec` is still not stored.
3. `eventVersion` moves only when the candidate set can change. That means a different canonical window set or a different duration. Title, context, location, and a timezone change with no new windows stay a metadata write.
4. `remainder_unavailable` applies only to the windows that participant last submitted against. New windows stay `unknown` on the next read.
5. A duration change clears every paint, sets coverage to `partial`, and treats that person as having evaluated nothing.
6. `submitAvailability` and `updateAvailability` require `eventVersion`. A mismatch throws `stale_version`. `withdrawResponse` does not take `eventVersion`.
7. You may edit an `open` or `closed` poll. A closed poll stays closed. Auto-reopen is not part of edit. `cancelled` and `finalized` reject the edit with `closed`.
8. Reopen does not bump `eventVersion` or `resultsVersion`.

## Call site 1. Organizer JSON

The handler parses the body, then calls the command. The token stays in the path.

```ts
app.post("/api/organizer/:token/update", async (c) => {
  const parsed = updateEventSchema.parse(await c.req.json());
  return c.json(
    await commands.updateEvent({
      organizerToken: c.req.param("token"),
      ...parsed,
    }),
  );
});

app.post("/api/organizer/:token/reopen", async (c) => {
  return c.json(await commands.reopen(c.req.param("token")));
});
```

Add a Monday window while collection is closed. The poll stays closed. Participants cannot submit until you reopen.

```ts
const organizer = await commands.getOrganizerEvent(token);
const updated = await commands.updateEvent({
  organizerToken: token,
  eventVersion: organizer.eventVersion,
  windows: [
    ...organizer.windows,
    { start: "2026-09-28T13:00:00Z", end: "2026-09-28T16:00:00Z" },
  ],
});
// updated.eventVersion === organizer.eventVersion + 1
// updated.invalidatedAnswers === false
// poll.status is still "closed"

await commands.reopen(token);
```

Fix a typo. `eventVersion` stays put. In-flight Choose forms remain valid.

```ts
await commands.updateEvent({
  organizerToken: token,
  eventVersion: updated.eventVersion,
  title: "Sprint planning",
});
```

Change duration from 60 to 30. Paints disappear. Tallies go to `unknown`. Respondents see `needsReevaluation: true`. `invalidatedAnswers` is true only on a duration wipe, not on a window-only edit.

```ts
const afterDuration = await commands.updateEvent({
  organizerToken: token,
  eventVersion: 2,
  durationMinutes: 30,
});
// afterDuration.eventVersion === 3
// afterDuration.invalidatedAnswers === true
```

Rebuild windows from a range in a new zone. That replace counts as a constraint change because the stored instants change.

```ts
await commands.updateEvent({
  organizerToken: token,
  eventVersion: afterDuration.eventVersion,
  timezone: "America/Los_Angeles",
  range: {
    startDate: "2026-09-21",
    endDate: "2026-09-21",
    weekdays: [1],
    dailyStart: "09:00",
    dailyEnd: "12:00",
  },
});
```

Send both `windows` and `range` and the command throws `validation`. Send an `eventVersion` that does not match the row and the command throws `stale_version`.

HTML posts the same fields to `POST /o/:token/update` and `POST /o/:token/reopen`, then 303s to `/o/:token`. The edit form is shown for `open` and `closed`. The Reopen button is shown for `closed` and `cancelled`.

## Call site 2. MCP and stdio

In-process MCP calls the commands. Stdio proxies the JSON routes so `remoteCommands` still `satisfies Commands`.

```ts
server.registerTool(
  "update_event",
  {
    title: "Update event",
    description:
      "Replace poll metadata or constraints. Send eventVersion. Constraint changes create a new event version.",
    inputSchema: updateEventSchema.extend({ organizerToken: z.string() }),
  },
  async (input) => toolResult(await commands.updateEvent(input)),
);

server.registerTool(
  "reopen_poll",
  {
    title: "Reopen poll",
    description: "Reopen a closed or cancelled poll so people can answer again.",
    inputSchema: z.object({ organizerToken: z.string() }),
  },
  async (input) => toolResult(await commands.reopen(input.organizerToken)),
);
```

```ts
const remoteCommands = {
  // ...existing methods
  updateEvent: (input) =>
    api("POST", `/api/organizer/${input.organizerToken}/update`, input),
  reopen: (token) => api("POST", `/api/organizer/${token}/reopen`),
} satisfies Commands;
```

Organizer WebMCP descriptors on `OrganizerPage` use those same JSON paths. Tool names are `update_event` and `reopen_poll`.

## Call site 3. Participant write after an edit

`PublicEvent.eventVersion` is already on every GET. Submit and update now send it. The HTML invitation and response forms add a hidden `eventVersion` field.

```ts
const view = await commands.getPublicEvent(publicId);
await commands.submitAvailability({
  publicId,
  name: "Alex",
  eventVersion: view.eventVersion,
  remainderUnavailable: true,
  intervals: [{ start: slot.start, end: slot.end, state: "available" }],
});
```

If the organizer replaced windows between the GET and the POST, the command throws `stale_version` with HTTP 409. Reload, then submit against the new candidates.

A participant who last answered with `remainder_unavailable` does not become a no on an added window. That slot stays `unknown` until they submit again. After that successful submit, their evaluated horizon becomes the current windows.

After a duration change, `getParticipantEvent` returns empty `intervals`, `coverageMode: "partial"`, and `needsReevaluation: true`. The page paints from `remapPaintedAnswers` in `overlap.ts`. It does not compare ISO strings.

## What you do not call

You do not call `store.setStatus` for reopen. You do not increment `eventVersion` in an adapter. You do not decide leftover paints in `pages.tsx` or `tools.ts`. You do not PATCH the organizer resource.

## Errors

A mismatched `eventVersion` on edit, submit, or update throws `stale_version` and HTTP 409.

Edit or reopen of a `finalized` poll throws `closed`. Edit of a `cancelled` poll throws `closed`. Reopen from any other blocked status throws `closed`.

Sending both `windows` and `range`, an empty title, a bad duration, or a bad timezone throws `validation`. Proposed windows that yield no candidate also throw `validation`. An unknown organizer token throws `not_found`.

A no-op save still requires a matching `eventVersion`. If the merged snapshot equals the stored row, the command returns the current versions and does not write.
