# Edit and reopen a poll

`updateEvent` accepts the organizer's complete proposed event definition and the version that the organizer read. It replaces the window set. It does not patch or append individual windows. A date range is a fresh authoring instruction because the service does not store the range used at creation.

Every successful change to the event definition increments `eventVersion`. A no-op returns the current version. Window changes retain answers only for candidate intervals that remain continuously offered. A duration, title, context, or location change clears active paints and requires every participant to answer again. A timezone-only change keeps answers because stored windows are absolute instants.

## Replace the offered windows

```ts
const current = await commands.getOrganizerEvent(organizerToken);

const result = await commands.updateEvent({
	organizerToken,
	eventVersion: current.eventVersion,
	event: {
		title: current.title,
		context: current.context,
		location: current.location,
		durationMinutes: current.durationMinutes,
		timezone: current.timezone,
		constraints: {
			kind: "windows",
			windows: [
				{
					start: "2026-09-23T13:00:00Z",
					end: "2026-09-23T17:00:00Z",
				},
				{
					start: "2026-09-24T13:00:00Z",
					end: "2026-09-24T17:00:00Z",
				},
			],
		},
	},
});

result.answerEffect.kind;
// "retained_on_continuous_candidates"
```

Existing participants keep answers for exact candidate intervals that remain offered. Every candidate first introduced by this replacement is `unknown`, including for a participant who selected `remainder_unavailable` or submitted one wide `available` paint.

## Change the duration on a closed poll, then reopen it

```ts
const current = await commands.getOrganizerEvent(organizerToken);

const changed = await commands.updateEvent({
	organizerToken,
	eventVersion: current.eventVersion,
	event: {
		title: current.title,
		context: current.context,
		location: current.location,
		durationMinutes: 90,
		timezone: current.timezone,
		constraints: {
			kind: "windows",
			windows: current.windows,
		},
	},
});

changed.status;
// "closed"
changed.answerEffect;
// { kind: "requires_reevaluation", reasons: ["duration"], affectedParticipants: 5 }

await commands.reopen(organizerToken);
await commands.reopen(organizerToken);
```

Editing a closed poll keeps it closed. `reopen` changes `closed` to `open`. Calling it again while the poll is open returns the same successful receipt without writing. A cancelled or finalized poll cannot reopen.

## Submit against the event that the participant saw

```ts
const event = await commands.getPublicEvent(publicId);

await commands.submitAvailability({
	publicId,
	eventVersion: event.eventVersion,
	name: "Sam",
	intervals: [
		{
			start: event.candidates[0]!.start,
			end: event.candidates[0]!.end,
			state: "available",
		},
	],
	remainderUnavailable: false,
});
```

`submitAvailability`, `updateAvailability`, and `withdrawResponse` all require `eventVersion`. The command returns `stale_version` if an organizer changes the event before the response commits. The participant reloads and submits against the new version.

## Adapter names

- JSON uses `POST /api/organizer/:token/update` and `POST /api/organizer/:token/reopen`.
- HTML uses matching `POST /o/:token/update` and `POST /o/:token/reopen` forms.
- MCP and WebMCP expose `update_event` and `reopen_poll`.
- The stdio adapter adds `updateEvent` and `reopen` to `remoteCommands satisfies Commands`.
- OpenAPI describes both POST operations and the shared update schema.
