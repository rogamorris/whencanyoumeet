/**
 * Sketch only. Do not copy these bodies into src/ as a first step.
 * Implement against the signatures. Throw until the real logic lands.
 *
 * Module map, in the order a reader should follow:
 *   types.ts        inputs, receipts, EvaluatedScope
 *   overlap.ts      what a paint means after an edit (policy lives here)
 *   windows.ts      expandRange, candidatesInWindows, unchanged
 *   commands.ts     updateEvent, reopen, eventVersion on submit and update
 *   schema.ts       participants.evaluated_windows
 *   migrate.ts      ALTER TABLE ... ADD COLUMN IF NOT EXISTS
 *   store.ts        applyEventEditIfFresh, reopenIfAllowed
 *   schemas.ts      zod at the HTTP and MCP boundary
 *   app.tsx         POST /update and POST /reopen, HTML and JSON
 *   pages.tsx       edit form, reopen button, hidden eventVersion, WebMCP
 *   tools.ts        update_event, reopen_poll
 *   stdio.ts        the two new Commands methods
 *   openapi.ts      the two new paths
 *
 * No lifecycle.ts. Status gates stay next to close, cancel, and finalize.
 */

import type {
  AvailabilityInterval,
  AvailabilityState,
  Candidate,
  CoverageMode,
  FourState,
  Interval,
  RangeSpec,
} from "../src/domain/types.ts";

// ---------------------------------------------------------------------------
// types.ts additions and changed inputs
// ---------------------------------------------------------------------------

export type EvaluatedScope =
  | { kind: "horizon"; windows: Interval[] }
  | { kind: "none" };

/**
 * Stored as participants.evaluated_windows TEXT.
 * null: legacy row, treat as current windows on read, materialize on first constraint edit.
 * []: kind "none" after a duration wipe.
 * non-empty JSON array: kind "horizon".
 */
export type StoredEvaluatedWindows = Interval[] | null;

export type EventSnapshot = {
  title: string;
  context: string | null;
  location: string | null;
  timezone: string;
  durationMinutes: number;
  windows: Interval[];
};

export type UpdateEventInput = {
  organizerToken: string;
  eventVersion: number;
  title?: string;
  context?: string | null;
  location?: string | null;
  timezone?: string;
  durationMinutes?: number;
  windows?: Interval[];
  range?: RangeSpec;
};

export type UpdateEventResult = {
  eventVersion: number;
  resultsVersion: number;
  receipt: string;
  invalidatedAnswers: boolean;
};

export type ReopenResult = {
  receipt: string;
};

export type SubmitAvailabilityInput = {
  publicId: string;
  name: string;
  eventVersion: number;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
};

export type UpdateAvailabilityInput = {
  responseToken: string;
  responseVersion: number;
  eventVersion: number;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
};

// ParticipantView and each OrganizerEvent participant row gain:
export type ReevaluationFlag = {
  needsReevaluation: boolean;
};

// ---------------------------------------------------------------------------
// overlap.ts: paint meaning. Adapters never import the plan type.
// ---------------------------------------------------------------------------

export type ConstraintDiff =
  | { kind: "unchanged" }
  | { kind: "windows"; previous: Interval[]; next: Interval[] }
  | { kind: "duration"; previous: number; next: number }
  | {
      kind: "both";
      previousWindows: Interval[];
      nextWindows: Interval[];
      previousDuration: number;
      nextDuration: number;
    };

/**
 * Side effects for one constraint diff. Derived, not stored.
 * wipeAnswers implies no orphan prune. The wipe deletes every interval.
 */
export type InvalidationPlan = {
  bumpEventVersion: boolean;
  bumpResultsVersion: boolean;
  replaceWindows: boolean;
  backfillLegacyScopes: boolean;
  pruneOrphanIntervals: boolean;
  wipeAnswers: boolean;
};

export function canonicalWindows(windows: Interval[]): Interval[] {
  throw new Error("not implemented");
  // TODO: parseInterval each window, sort by start, emit iso(start) and iso(end).
  // Compare with these strings so HTML echoing T13:00:00.000Z matches T13:00:00Z.
}

export function windowsEqual(left: Interval[], right: Interval[]): boolean {
  throw new Error("not implemented");
  void left;
  void right;
}

export function diffConstraints(previous: EventSnapshot, next: EventSnapshot): ConstraintDiff {
  throw new Error("not implemented");
  void previous;
  void next;
  // TODO: windowsEqual on canonical windows, then compare durationMinutes.
  // Title, context, location, timezone do not enter the diff.
}

export function planInvalidation(diff: ConstraintDiff): InvalidationPlan {
  throw new Error("not implemented");
  void diff;
  // unchanged: every flag false.
  // windows: bump both versions, replace windows, backfill legacy scopes, prune orphans.
  // duration or both: bump both versions, replace windows if they changed, wipe answers.
}

export function hydrateEvaluatedScope(raw: StoredEvaluatedWindows): EvaluatedScope | "legacy" {
  throw new Error("not implemented");
  void raw;
}

export function scopeForRead(
  raw: StoredEvaluatedWindows,
  currentWindows: Interval[],
): EvaluatedScope {
  throw new Error("not implemented");
  void raw;
  void currentWindows;
  // legacy -> { kind: "horizon", windows: currentWindows }
}

/**
 * A candidate outside the evaluated horizon is unknown, even when
 * coverageMode is remainder_unavailable.
 * kind "none" makes every candidate unknown.
 */
export function effectiveState(
  intervals: AvailabilityInterval[],
  candidate: Candidate,
  coverageMode: CoverageMode,
  scope: EvaluatedScope,
): FourState {
  throw new Error("not implemented");
  void intervals;
  void candidate;
  void coverageMode;
  void scope;
}

export function needsReevaluation(scope: EvaluatedScope, candidates: Candidate[]): boolean {
  throw new Error("not implemented");
  void scope;
  void candidates;
  // kind "none" -> true
  // else true when some candidate is not inside scope.windows
}

export function remapPaintedAnswers(
  intervals: AvailabilityInterval[],
  candidates: Candidate[],
): Map<string, AvailabilityState> {
  throw new Error("not implemented");
  void intervals;
  void candidates;
  // TODO: stateForCandidate per candidate using Temporal covers. Skip unknown.
  // ParticipantPage must call this. String >= / <= on ISO text is not allowed here.
}

export function pruneIntervalsToWindows(
  intervals: AvailabilityInterval[],
  windows: Interval[],
): AvailabilityInterval[] {
  throw new Error("not implemented");
  void intervals;
  void windows;
}

export function tallyCandidates(
  candidates: Candidate[],
  participants: Array<{
    withdrawn: boolean;
    coverageMode: CoverageMode;
    intervals: AvailabilityInterval[];
    evaluatedWindows: StoredEvaluatedWindows;
  }>,
  currentWindows: Interval[],
): import("../src/domain/types.ts").SlotTally[] {
  throw new Error("not implemented");
  void candidates;
  void participants;
  void currentWindows;
  // TODO: scopeForRead per person, then effectiveState(..., scope).
}

export function resultsLanguage(respondentCount: number, needsReevaluationCount: number): string {
  throw new Error("not implemented");
  void respondentCount;
  void needsReevaluationCount;
}

// ---------------------------------------------------------------------------
// commands.ts
// ---------------------------------------------------------------------------

export type OrganizerReceipt = { receipt: string };

export function mergeEventSnapshot(
  current: EventSnapshot,
  input: Omit<UpdateEventInput, "organizerToken" | "eventVersion">,
): EventSnapshot {
  throw new Error("not implemented");
  void current;
  void input;
  // TODO: reject windows and range together.
  // timezone = assertTimeZone(input.timezone ?? current.timezone)
  // windows = input.windows ?? expandRange(timezone, input.range) ?? current.windows
  // empty windows array is validation, not "clear the poll"
  // trim title the same way createPoll does
}

export type UpdateEventCommand = (
  input: UpdateEventInput,
) => Promise<UpdateEventResult>;

export type ReopenCommand = (organizerToken: string) => Promise<ReopenResult>;

/**
 * commands.updateEvent
 *
 * 1. Resolve poll by organizer token hash.
 * 2. Status finalized or cancelled -> closed.
 * 3. status must be open or closed.
 * 4. Load windows. Build current EventSnapshot.
 * 5. proposed = mergeEventSnapshot(current, input)
 * 6. assertDuration, assertTimeZone, candidatesInWindows(proposed...)
 * 7. If input.eventVersion !== poll.eventVersion -> stale_version.
 * 8. diff = diffConstraints(current, proposed); plan = planInvalidation(diff)
 * 9. If plan is all-false and metadata equals current, return current versions.
 * 10. store.applyEventEditIfFresh({ poll, expectedEventVersion, proposed, plan })
 * 11. Return versions, receipt, invalidatedAnswers: plan.wipeAnswers
 *
 * Status does not change. Closed stays closed.
 */
export async function updateEvent(input: UpdateEventInput): Promise<UpdateEventResult> {
  throw new Error("not implemented");
  void input;
}

/**
 * commands.reopen
 *
 * 1. Resolve poll by organizer token hash.
 * 2. store.reopenIfAllowed(poll.id)
 *    already_open -> same receipt, no write
 *    opened -> same receipt
 *    finalized -> closed
 * 3. Do not bump versions. Do not clear finalizedStart. Finalize is not a source.
 */
export async function reopen(organizerToken: string): Promise<ReopenResult> {
  throw new Error("not implemented");
  void organizerToken;
}

/**
 * submitAvailability and updateAvailability gain:
 *   if (input.eventVersion !== poll.eventVersion) stale_version
 *   store write includes evaluatedWindows: current windows
 * withdrawResponse is unchanged.
 */
export async function submitAvailability(input: SubmitAvailabilityInput): Promise<unknown> {
  throw new Error("not implemented");
  void input;
}

export async function updateAvailability(input: UpdateAvailabilityInput): Promise<unknown> {
  throw new Error("not implemented");
  void input;
}

// ---------------------------------------------------------------------------
// store.ts
// ---------------------------------------------------------------------------

export type EventEditWrite = {
  pollId: string;
  expectedEventVersion: number;
  snapshot: EventSnapshot;
  plan: InvalidationPlan;
  previousWindows: Interval[];
};

/**
 * One drizzle db.transaction. Do not use setStatus.
 *
 * UPDATE polls SET
 *   title, context, location, timezone, duration_minutes,
 *   event_version = event_version + (plan.bumpEventVersion ? 1 : 0),
 *   results_version = results_version + (plan.bumpResultsVersion ? 1 : 0),
 *   updated_at
 * WHERE id = ? AND event_version = ? AND status IN ('open', 'closed')
 *
 * Zero rows after a pre-checked poll -> stale_version.
 *
 * Then, inside the same transaction:
 *   replaceWindows -> DELETE windows for poll, INSERT snapshot.windows
 *   backfillLegacyScopes -> SET evaluated_windows = previousWindows
 *     WHERE poll_id = ? AND evaluated_windows IS NULL
 *   wipeAnswers -> DELETE intervals for those participants
 *     UPDATE participants SET coverage_mode = 'partial', evaluated_windows = '[]',
 *     response_version = response_version + 1
 *   pruneOrphanIntervals -> DELETE interval rows that fail intervalInsideWindows
 *
 * Return the new eventVersion and resultsVersion.
 */
export async function applyEventEditIfFresh(
  input: EventEditWrite,
): Promise<{ eventVersion: number; resultsVersion: number }> {
  throw new Error("not implemented");
  void input;
}

export type ReopenWriteResult = "opened" | "already_open";

/**
 * UPDATE polls SET status = 'open' WHERE id = ? AND status IN ('closed', 'cancelled')
 * Zero rows and status === 'open' -> already_open
 * Zero rows and status === 'finalized' -> throw closed
 */
export async function reopenIfAllowed(pollId: string): Promise<ReopenWriteResult> {
  throw new Error("not implemented");
  void pollId;
}

export type InsertParticipantInput = {
  pollId: string;
  displayName: string;
  responseTokenHash: string;
  coverageMode: CoverageMode;
  intervals: AvailabilityInterval[];
  evaluatedWindows: Interval[];
};

export type UpdateParticipantPatch = {
  coverageMode: CoverageMode;
  withdrawn: boolean;
  intervals: AvailabilityInterval[];
  evaluatedWindows: Interval[];
};

// ---------------------------------------------------------------------------
// db: schema + migrate
// ---------------------------------------------------------------------------

export const PARTICIPANT_SCOPE_MIGRATION = `
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS evaluated_windows TEXT;
`;

// drizzle: evaluatedWindows: text("evaluated_windows")  // nullable

// ---------------------------------------------------------------------------
// http/schemas.ts
// ---------------------------------------------------------------------------

export const updateEventSchemaShape = {
  eventVersion: "z.number().int().min(1)",
  title: "z.string().min(1).max(200).optional()",
  context: "z.string().max(2000).nullable().optional()",
  location: "z.string().max(500).nullable().optional()",
  timezone: "z.string().min(1).optional()",
  durationMinutes: "z.number().int().optional()",
  windows: "z.array(intervalSchema).min(1).optional()",
  range: "rangeSchema.optional()",
  refine: "not both windows and range",
};

export const submitAndUpdateGain = {
  eventVersion: "z.number().int().min(1)",
};

// ---------------------------------------------------------------------------
// Adapter routes. POST only. No organizer PATCH.
// ---------------------------------------------------------------------------

export const adapterRoutes = {
  htmlUpdate: "POST /o/:token/update -> 303 /o/:token",
  jsonUpdate: "POST /api/organizer/:token/update -> UpdateEventResult",
  htmlReopen: "POST /o/:token/reopen -> 303 /o/:token",
  jsonReopen: "POST /api/organizer/:token/reopen -> ReopenResult",
  webmcp: ["update_event POST /api/organizer/<token>/update", "reopen_poll POST /api/organizer/<token>/reopen"],
  mcp: ["update_event", "reopen_poll"],
};

/**
 * OrganizerPage
 *   edit form when status is open or closed
 *   hidden eventVersion
 *   current windows as start and end fields, posted as windows[]
 *   Reopen when status is closed or cancelled
 *
 * InvitationPage and ParticipantPage
 *   hidden eventVersion on submit and update
 *   remapPaintedAnswers(event.intervals, event.candidates)
 *   banner when needsReevaluation
 */
export const pageNotes = true;

// ---------------------------------------------------------------------------
// Tests. Do not reuse the PGlite persistence name.
// ---------------------------------------------------------------------------

export const testNames = [
  "reopens a closed poll and accepts responses",
  "reopens a cancelled poll and keeps existing paints",
  "reopen of an open poll is idempotent",
  "does not reopen a finalized poll",
  "updateEvent bumps eventVersion when windows change",
  "updateEvent does not bump eventVersion for a title edit",
  "updateEvent of identical windows does not bump eventVersion",
  "remainder_unavailable does not mark an added window unavailable",
  "duration change clears paints and marks respondents as needing reevaluation",
  "submit with a stale eventVersion returns 409",
  "updateEvent on a closed poll keeps the poll closed",
  "stale finalize after updateEvent returns 409",
  "updateEvent is rejected on a finalized poll",
  "updateEvent is rejected on a cancelled poll",
] as const;
