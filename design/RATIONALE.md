# Event editing and reopen

## Problem

An organizer must change a poll without letting old availability acquire a new meaning. The current model stores windows and paints, then derives candidates on every read. A wide paint can cover a candidate added later, and `remainder_unavailable` treats every unpainted future candidate as unavailable. `eventVersion` cannot prevent this today because it never changes, participant writes do not send it, and the store cannot replace windows atomically. The design must also add reopen without weakening the terminal meaning of cancellation or finalization.

## Usage (caller's view)

The caller reads the current event, submits one complete replacement with the version it read, and receives the answer effect.

```ts
const current = await commands.getOrganizerEvent(organizerToken);

const changed = await commands.updateEvent({
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
			windows: replacementWindows,
		},
	},
});
```

A participant sends the event version that supplied the candidates.

```ts
const event = await commands.getPublicEvent(publicId);

await commands.submitAvailability({
	publicId,
	eventVersion: event.eventVersion,
	name: "Sam",
	intervals,
	remainderUnavailable: true,
});
```

Reopen is a token-only lifecycle command.

```ts
await commands.reopen(organizerToken);
```

[`USAGE.md`](./USAGE.md) shows window replacement, duration invalidation, idempotent reopen, and participant freshness.

## Shape

The core structure is a current-candidate continuity registry. `candidate_continuity` has one row for each current candidate. The row stores the candidate's canonical start and end plus the `eventVersion` at which that exact pair most recently entered the continuously offered set. A participant stores `answeredEventVersion`. `effectiveStateForCandidate` returns `unknown` before it examines paints when the candidate was introduced after that answer.

On a window edit, an exact candidate present before and after keeps its introduction version. A new candidate gets the next version. Removing and later re-adding a candidate also gives it a new introduction version because the removal deleted its row. This handles wide paints, `remainder_unavailable`, overlapping windows, and remove-then-readd without storing a candidate set per participant. The data structure encodes answer scope once, per `principle-model-the-domain`.

`UpdateEventInput` carries a full proposed event definition. Its `constraints` field is a discriminated union between absolute windows and a fresh range. The domain expands the range immediately and stores only canonical UTC windows. A full replacement avoids an optional-field patch with ambiguous clear, omit, append, and replace states, per `principle-type-system-discipline`.

`planEventUpdate` is pure. It canonicalizes text, instants, timezone, windows, and candidates before comparison. It returns either a no-op or one complete write plan. HTTP, HTML, MCP, WebMCP, stdio, and OpenAPI parse external values into that input and do not own invalidation rules, per `principle-boundary-discipline`.

The eight product decisions are fixed:

1. `reopen` accepts `closed`. It returns success without writing for `open`. It rejects `cancelled` and `finalized`.
2. An update replaces the complete window set. A range is a fresh replacement recipe. There is no add-window operation.
3. Every non-noop change to title, context, location, duration, timezone, or windows increments `eventVersion`. Title, context, and location count as meeting meaning and require re-evaluation. Duration also requires re-evaluation. A timezone-only edit keeps answers because windows are absolute instants.
4. `remainder_unavailable` applies only when `answeredEventVersion` is at least the candidate's `introducedEventVersion`. Candidates added later remain `unknown`.
5. A duration or meeting-meaning change deletes every participant's paints, changes coverage to `partial`, increments each `responseVersion`, and marks each response with `invalidatedAtEventVersion`. It never keeps geometric coverage.
6. Submit, update, and withdraw require `eventVersion`. The store checks it together with open status during the answer transaction.
7. An organizer may edit an open or closed poll. An edit keeps a closed poll closed. Reopening collection remains an explicit action.
8. Reopen is idempotent while already open. It does not change `eventVersion` or `resultsVersion`.

`updateEventIfFresh` owns one database transaction. It compare-and-swaps the poll's status and `eventVersion`, replaces windows, replaces candidate continuity, and applies any answer invalidation. It increments `resultsVersion` once when it clears answers. This prevents a crash from leaving unreadable constraints and makes a retry converge to either one committed edit or `stale_version`, per `principle-make-operations-idempotent`.

`commitAnswerIfCurrent` owns participant mutation transactions. Its first write increments `resultsVersion` only when the poll is open and its `eventVersion` matches the request. The same transaction then inserts or updates the participant and replaces intervals. A concurrent finalize either commits first and closes the answer write, or observes the incremented results version and fails its freshness check. The poll row is genuinely shared state, so the database compare-and-swap serializes it structurally, per `principle-separate-before-serializing-shared-state`.

The public capability remains two organizer methods, `updateEvent` and `reopen`. The caller never manages candidate scopes, invalidation, transactions, or status races. The call chain stays adapter, command, pure planner, and store transaction. `event-update.ts` owns one body of domain knowledge instead of splitting load, validate, remap, and save modules, per `principle-minimize-reader-load`. This is a redesign around edits as a founding requirement rather than a flag added to `effectiveState`, per `principle-redesign-from-first-principles`.

The maintainer inherits one explicit invariant. A candidate can use an answer exactly when it has remained continuously offered since that answer. The participant sees old choices retained where they still mean the same thing and receives unknown choices everywhere else, per `principle-experience-first`.

The schema adds `participants.answered_event_version`, `participants.invalidated_at_event_version`, and `candidate_continuity`. Creation and migration both seed continuity at version 1. The migration backfills existing participants at version 1 because the current code has never incremented `eventVersion`. The complex update schema has one zod definition. WebMCP and OpenAPI consume JSON Schema converted from that zod value instead of copying it by hand.

## Synthesis decision

Use current-candidate continuity as this candidate's base. It gives exact retention semantics with storage proportional to current candidates, not participants or edit history. Keep the full replacement command and the atomic store write. Do not graft event-history reads or caller-managed invalidation into this shape.

## Tradeoffs accepted

- We accept one materialized row per current candidate in exchange for exact answer scope across growth, shrink, and remove-then-readd edits.
- We accept a participant reload after a timezone-only edit in exchange for one version that prevents lost organizer updates.
- We accept invalidating answers after any title, context, or location change in exchange for never guessing whether a prose edit changed meeting meaning.
- We accept deleting old paints after meaning or duration changes in exchange for making re-evaluation real rather than advisory.
- We accept a full replacement payload in exchange for one atomic definition with no patch merge rules.
- We accept an explicit reopen after editing a closed poll in exchange for preserving the organizer's collection state.

## Alternatives considered

- Immutable event revisions could retain every definition and intersect candidate sets across every revision since each answer. It hides history behind the same public command, but it adds unbounded history, multi-revision reads, and a longer call chain. Current-candidate continuity stores the only historical fact that tallying needs.
- Per-participant candidate snapshots could gate paints exactly. They hide scope from callers, but storage grows by participants times candidates and every window edit must rewrite many independent scopes. The chosen registry stores each continuity fact once.
- Clearing all answers on every window edit has a small implementation. It exposes that simplicity as repeated work for participants and discards answers whose candidate meaning did not change.
- Downgrading only `remainder_unavailable` to `partial` leaves wide explicit paints able to mark new candidates available. It does not satisfy the added-window rule.

## Open questions and risks

- What candidate count appears in production-like polls, and should the boundary add a hard candidate limit before materializing continuity rows?
- Can startup migration backfill all current candidate rows in one transaction within the existing PGlite startup budget?
- Do any API consumers infer candidate states directly from raw paints instead of using the returned candidate states?

## Next implementation step

Implement and test `reconcileCandidateContinuity` for growth, shrink, remove-then-readd, timezone-only, and full invalidation cases.
