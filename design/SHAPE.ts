/**
 * Event modification and reopen — type sketch.
 *
 * Bodies are `not implemented`. Tricky logic is `// TODO` pseudocode. Every type and signature here
 * is derived from design/USAGE.md; where the two disagree, USAGE.md wins.
 *
 * Module map (dependency order; `+` is new, `~` is a changed signature):
 *
 *   ~ src/domain/types.ts      EventConstraints, EventMetadata, EventPatch, UpdateEventInput,
 *                              UpdateEventResult, RevisionImpact, ParticipantResponse, EventWrite.
 *                              Submit/Update inputs gain eventVersion. ParticipantView and
 *                              OrganizerEvent participants gain needsReevaluation.
 *   ~ src/domain/windows.ts    + clipIntervalsToWindows (pure geometry, reused for paints and scopes)
 *   ~ src/domain/overlap.ts    effectiveState/tallyCandidates take an Answer carrying its own scope;
 *                              + needsReevaluation; resultsLanguage reports the stale count
 *   + src/domain/revision.ts   planRevision — the whole invalidation policy, one exported function
 *   ~ src/domain/commands.ts   + updateEvent, + reopen; submit/update enforce eventVersion and stamp
 *                              the constraints they answered
 *   ~ src/db/schema.ts         participants.answeredConstraints (text, JSON, NOT NULL)
 *   ~ src/db/migrate.ts        ALTER TABLE + backfill + SET NOT NULL
 *   ~ src/db/store.ts          + applyEventRevision (the only transactional write), + setStatusIfIn
 *                              (replaces the blind setStatus), participants returned as domain rows
 *   ~ src/http/schemas.ts      + updateEventSchema; submit/update gain eventVersion; + jsonSchemaFor
 *   ~ src/app.tsx              4 routes (HTML + JSON for update and reopen)
 *   ~ src/http/pages.tsx       organizer edit card, Reopen button, hidden eventVersion on participant
 *                              forms, WebMCP descriptors derived from zod
 *   ~ src/mcp/tools.ts         update_event, reopen_poll
 *   ~ src/mcp/stdio.ts         two lines; the compiler forces this one
 *   ~ src/http/openapi.ts      4 path entries
 *
 * Reading this file top to bottom traces an edit from HTTP body to stored rows and back out through
 * the tallies.
 */

import type { Db, PollRecord, Store } from "../src/db/store.ts";
import type {
  AvailabilityInterval,
  Candidate,
  CoverageMode,
  FourState,
  InstantIso,
  Interval,
  PollStatus,
  RangeSpec,
  SlotTally,
} from "../src/domain/types.ts";

/* ────────────────────────────────────────────────────────────────────────────
 * src/domain/types.ts
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The question a poll asks: which concrete time is on offer, and how long the meeting is.
 *
 * This is the only thing that can invalidate an answer, which is why it is one type rather than two
 * fields spread across the poll row. Candidates are derived from it and never stored.
 */
export type EventConstraints = {
  durationMinutes: number;
  windows: Interval[];
};

/** Everything an organizer can change that moves no candidate. */
export type EventMetadata = {
  title: string;
  context: string | null;
  location: string | null;
  timezone: string;
};

/**
 * Statuses in which a poll is live: it can be finalized, and its offer can be edited.
 *
 * Single source of truth for "live". `finalizeIfFresh`, `planRevision`, and `reopen`'s target all
 * read this instead of restating the set. Per encode-lessons-in-structure.
 */
export const LIVE_STATUSES = ["open", "closed"] as const satisfies readonly PollStatus[];

/**
 * A declarative patch. Absent fields mean "leave it alone"; they do not mean "unchanged", because
 * the effect of an edit is computed by diffing the resolved result against stored state. An HTML
 * form that posts every field it renders therefore produces no spurious invalidation.
 *
 * `windows` and `range` are mutually exclusive. Either replaces the offer wholesale; there is no
 * add-one-window primitive, because window identity is not part of the public surface.
 */
export type EventPatch = {
  title?: string;
  context?: string | null;
  location?: string | null;
  timezone?: string;
  durationMinutes?: number;
  windows?: Interval[];
  range?: RangeSpec;
};

export type UpdateEventInput = EventPatch & {
  organizerToken: string;
  /** Compare-and-swap, as in FinalizeInput. Not resultsVersion: an edit does not depend on tallies. */
  eventVersion: number;
};

/** What the edit did, in terms the organizer can act on without a second read. */
export type RevisionImpact = {
  /** True exactly when eventVersion advanced, i.e. when windows or duration moved. */
  constraintsChanged: boolean;
  candidatesBefore: number;
  candidatesAfter: number;
  /** Responses that answered a different meeting length. They count as unknown until re-answered. */
  responsesNeedingReevaluation: number;
  /** Responses whose paints were narrowed because the offer shrank. */
  responsesNarrowed: number;
};

export type UpdateEventResult = {
  eventVersion: number;
  impact: RevisionImpact;
  receipt: string;
};

/**
 * A stored answer, together with the question it answered.
 *
 * Invariants, maintained by validatePaintedIntervals on write and by planRevision on edit:
 *   1. `answered.windows` ⊆ the poll's current windows
 *   2. every interval lies inside one window of `answered.windows`
 *
 * (1) is what makes newly offered time unknown for a remainder_unavailable respondent: it is
 * outside the scope they evaluated. (2) is what makes a client's read-modify-write round trip
 * always re-postable.
 */
export type ParticipantResponse = {
  id: string;
  pollId: string;
  displayName: string;
  withdrawn: boolean;
  coverageMode: CoverageMode;
  responseVersion: number;
  answered: EventConstraints;
  intervals: AvailabilityInterval[];
  createdAt: InstantIso;
  updatedAt: InstantIso;
};

/** The slice of a response that determines a four-state answer. Structural, so tests stay small. */
export type Answer = Pick<ParticipantResponse, "coverageMode" | "answered" | "intervals">;

/** Participant writes now prove which version of the offer they were looking at. */
export type SubmitAvailabilityInput = {
  publicId: string;
  eventVersion: number;
  name: string;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
};

export type UpdateAvailabilityInput = {
  responseToken: string;
  eventVersion: number;
  responseVersion: number;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
};

// withdrawResponse is unchanged: leaving is not an answer, so it needs no eventVersion.

/** ParticipantView gains `needsReevaluation`; OrganizerEvent gains it per participant. */
export type ParticipantViewAdditions = { needsReevaluation: boolean };
export type OrganizerParticipantAdditions = { needsReevaluation: boolean };

/**
 * The persistence contract for one edit. Produced whole by planRevision, consumed whole by
 * store.applyEventRevision. Nothing recomputes a field of it.
 */
export type EventWrite = {
  pollId: string;
  /** CAS. Zero rows updated means someone else moved the offer first. */
  expectedEventVersion: number;
  allowedStatuses: readonly PollStatus[];
  /** Equal to expectedEventVersion when nothing about the question changed. */
  nextEventVersion: number;
  metadata: EventMetadata;
  durationMinutes: number;
  /** null leaves stored windows untouched; otherwise the complete replacement set. */
  windows: Interval[] | null;
  /** Responses whose stored answer must be narrowed to the surviving offer. */
  responses: readonly ResponseClip[];
};

export type ResponseClip = {
  responseId: string;
  answered: EventConstraints;
  intervals: AvailabilityInterval[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * src/domain/windows.ts — pure geometry, no policy
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Intersect each interval with the window set, preserving any extra fields (so it clips painted
 * intervals and answered scopes with the same code). An interval spanning a gap the organizer just
 * opened yields one piece per surviving window; an interval with no surviving overlap disappears.
 *
 * Deliberately does not enforce MAX_INTERVALS_PER_RESPONSE: that cap governs what a client may
 * send, not what a narrowing produces. Splitting is bounded by the new window count.
 */
export function clipIntervalsToWindows<T extends Interval>(
  intervals: readonly T[],
  windows: readonly Interval[],
): T[] {
  // TODO parse both sides with Temporal once, then for each interval emit
  // {max(start, w.start), min(end, w.end)} for every window with a non-empty overlap.
  // Never compare ISO strings; client-formatted instants are not byte-comparable.
  throw new Error("not implemented");
}

/** True when the interval sits entirely inside one of the windows. Thin wrapper over covers(). */
export function insideWindows(interval: Interval, windows: readonly Interval[]): boolean {
  throw new Error("not implemented");
}

/** Structural equality of two offers, compared as instants rather than as strings. */
export function sameWindows(a: readonly Interval[], b: readonly Interval[]): boolean {
  // TODO normalizeWindows both sides (sorts), then compare pairwise by epochMilliseconds.
  throw new Error("not implemented");
}

/* ────────────────────────────────────────────────────────────────────────────
 * src/domain/overlap.ts — answer semantics
 * ──────────────────────────────────────────────────────────────────────────── */

// stateForCandidate(intervals, candidate) is unchanged: full coverage only, most pessimistic
// covering paint wins. Fragments still never union into a yes.

/**
 * The four-state answer this response gives for one candidate.
 *
 * Changed from `effectiveState(intervals, candidate, coverageMode)`: the remainder rule needs the
 * scope the participant evaluated, and passing the whole answer keeps that datum next to the
 * decision instead of threaded through as a fourth parameter.
 *
 * `unknown` is promoted to `unavailable` only inside `answer.answered.windows`. Time the organizer
 * added after this answer was given is outside that scope and stays unknown. PRD §7.2.
 */
export function effectiveState(answer: Answer, candidate: Candidate): FourState {
  // TODO const state = stateForCandidate(answer.intervals, candidate);
  //      if (state !== "unknown" || answer.coverageMode !== "remainder_unavailable") return state;
  //      return insideWindows(candidate, answer.answered.windows) ? "unavailable" : "unknown";
  throw new Error("not implemented");
}

/**
 * True when this answer was given for a different meeting length than the one now being asked.
 * Derived on every read from two stored numbers, so reverting the duration restores the answers
 * and nothing has to be un-flagged. Per single-source-of-truth.
 */
export function needsReevaluation(
  answer: Pick<Answer, "answered">,
  asking: EventConstraints,
): boolean {
  // TODO return answer.answered.durationMinutes !== asking.durationMinutes;
  throw new Error("not implemented");
}

/** Responses needing re-evaluation contribute `unknown` to every candidate. */
export function tallyCandidates(
  candidates: readonly Candidate[],
  responses: readonly (Answer & { withdrawn: boolean })[],
  asking: EventConstraints,
): SlotTally[] {
  throw new Error("not implemented");
}

/** Honest aggregation language, now covering answers that no longer answer the question. */
export function resultsLanguage(respondentCount: number, needingReevaluation: number): string {
  throw new Error("not implemented");
}

/* ────────────────────────────────────────────────────────────────────────────
 * src/domain/revision.ts (new) — the whole invalidation policy
 *
 * One exported function. Pure: no store, no clock, no tokens. Everything the organizer surfaces
 * report about an edit comes out of its return value.
 * ──────────────────────────────────────────────────────────────────────────── */

export type ConstraintsChange =
  /** The resolved offer equals the stored one. eventVersion does not move. */
  | { kind: "unchanged" }
  /** Offered time moved; the meeting length did not. Existing answers keep their meaning. */
  | { kind: "windows"; widened: boolean; narrowed: boolean }
  /** The meeting length moved. Every existing answer answered a different question. */
  | { kind: "duration"; from: number; to: number };

export type EventRevision = {
  /** Hand straight to store.applyEventRevision. */
  write: EventWrite;
  /** The resolved "after" question. Candidates are derived from this, never stored. */
  constraints: EventConstraints;
  change: ConstraintsChange;
  impact: RevisionImpact;
  /** Prose for the receipt, in the product's honest-aggregation register. */
  receipt: string;
};

export type CurrentEvent = {
  pollId: string;
  eventVersion: number;
  metadata: EventMetadata;
  constraints: EventConstraints;
};

/**
 * Decide everything an edit does, before anything is written.
 *
 * Throws DomainError("validation") for a patch that cannot produce a readable poll: both `windows`
 * and `range` supplied, a bad duration or time zone, a horizon over 60 days, or an offer in which
 * no full-duration meeting fits. That last check is the one that keeps every GET working, since
 * candidatesInWindows throws on read.
 *
 * Deliberately not exported from this module: constraint resolution, diffing, clipping, and receipt
 * prose. A caller that could invoke those separately could produce a half-applied edit.
 */
export function planRevision(
  current: CurrentEvent,
  responses: readonly ParticipantResponse[],
  patch: EventPatch,
): EventRevision {
  // TODO 1. resolve metadata: { ...current.metadata, ...defined fields of patch }, trimmed and
  //         bounded exactly as createPoll does (MAX_TITLE, assertTimeZone).
  //      2. resolve constraints:
  //           duration = patch.durationMinutes ?? current.constraints.durationMinutes; assertDuration
  //           windows  = patch.windows        ?? (patch.range ? expandRange(tz, patch.range)
  //                                                           : current.constraints.windows)
  //         where tz is the *resolved* timezone, so editing the zone and the range together
  //         re-expands in the new zone and editing the zone alone moves nothing.
  //      3. candidatesInWindows(windows, duration) — validation gate, plus the before/after counts.
  //      4. const windowsMoved = !sameWindows(windows, current.constraints.windows);
  //         change = duration moved ? { kind: "duration", from, to }   // outranks windows: a
  //                                                                   // different length is a
  //                                                                   // different question either way
  //                : windowsMoved   ? { kind: "windows", widened, narrowed }
  //                                 : { kind: "unchanged" };
  //      5. nextEventVersion = change.kind === "unchanged" ? current.eventVersion
  //                                                        : current.eventVersion + 1
  //      6. clip: for each response, clipIntervalsToWindows over BOTH its paints and its
  //         answered.windows, against the resolved windows. Emit a ResponseClip only when
  //         something actually changed. Clipping the scope alongside the paints is what stops a
  //         shrink-then-regrow from resurrecting a remainder as a false "no".
  //         Answered duration is never restamped here: only the participant can re-answer.
  //      7. write.windows = windowsMoved ? windows : null   // keyed off the geometry, not the
  //                                                         // change kind, so a duration-only
  //                                                         // edit does not churn window rows
  //      8. impact + receipt.
  throw new Error("not implemented");
}

/* ────────────────────────────────────────────────────────────────────────────
 * src/db/schema.ts and src/db/migrate.ts
 *
 *   polls: unchanged.
 *   participants: + answered_constraints TEXT NOT NULL   -- JSON EventConstraints
 *
 * migrate.ts, after the CREATE TABLE IF NOT EXISTS block, because persisted PGlite data dirs
 * already have the table (gotcha 12):
 *
 *   ALTER TABLE participants ADD COLUMN IF NOT EXISTS answered_constraints TEXT;
 *   UPDATE participants p SET answered_constraints = (
 *     SELECT json_build_object(
 *       'durationMinutes', po.duration_minutes,
 *       'windows', COALESCE(json_agg(json_build_object('start', w.start_at, 'end', w.end_at))
 *                           FILTER (WHERE w.id IS NOT NULL), '[]'::json))::text
 *     FROM polls po LEFT JOIN windows w ON w.poll_id = po.id
 *     WHERE po.id = p.poll_id GROUP BY po.duration_minutes
 *   ) WHERE answered_constraints IS NULL;
 *   ALTER TABLE participants ALTER COLUMN answered_constraints SET NOT NULL;
 *
 * Existing answers are stamped with the constraints they are currently being read against, which is
 * exactly what they answered — nothing has ever been edited. The column is NOT NULL from the first
 * migration onward, so ParticipantResponse.answered is not optional and no read path needs a
 * fallback. Per encode-lessons-in-structure.
 * ──────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────────
 * src/db/store.ts
 * ──────────────────────────────────────────────────────────────────────────── */

export function storeAdditions(db: Db) {
  return {
    /**
     * The whole edit, atomically, under a compare-and-swap. The only transactional method in the
     * store, and the reason there is no generic `store.transaction(fn)`: a transaction handle in
     * the domain would put driver types on a domain call path.
     *
     * Zero rows from the guarded UPDATE means the poll moved or left `allowedStatuses`; nothing
     * else in the transaction runs, so a poll never lands with windows that yield no candidate.
     */
    async applyEventRevision(write: EventWrite): Promise<PollRecord> {
      // TODO db.transaction(async (tx) => {
      //   UPDATE polls SET title, context, location, timezone, duration_minutes,
      //                    event_version = write.nextEventVersion, updated_at = now
      //     WHERE id = ? AND event_version = write.expectedEventVersion
      //                  AND status IN write.allowedStatuses
      //     RETURNING *;                       -- 0 rows -> throw stale_version, rolls back
      //   if (write.windows) { DELETE FROM windows WHERE poll_id = ?; INSERT the new set; }
      //   for (const clip of write.responses) {
      //     UPDATE participants SET answered_constraints = encode(clip.answered) WHERE id = ?;
      //     DELETE FROM intervals WHERE participant_id = ?; INSERT clip.intervals;
      //   }
      // });
      // Does NOT touch response_version: clipping is a consequence of the organizer's act, not a
      // participant edit, and bumping it would 409 every in-flight participant update.
      throw new Error("not implemented");
    },

    /**
     * Guarded status transition. Returns undefined when the poll was not in `from`, which is how
     * reopen distinguishes "already open" (idempotent no-op) from "wrong state" (error).
     *
     * Replaces the blind `setStatus`, which accepted an `extra` patch that could silently write
     * eventVersion with no precondition. close and cancel adopt this too, so every status write in
     * the codebase is either this or finalizeIfFresh. Per subtract-before-you-add.
     */
    async setStatusIfIn(
      pollId: string,
      next: PollStatus,
      from: readonly PollStatus[],
    ): Promise<PollRecord | undefined> {
      throw new Error("not implemented");
    },

    /**
     * Participants as domain rows, with intervals and the decoded answered constraints.
     *
     * Replaces listParticipants + listIntervals (an N+1 in getOrganizerEvent) and removes the
     * `as CoverageMode` casts in commands.ts. JSON decoding of answered_constraints happens here
     * and nowhere else; the encoding is not a fact any other module knows. Per boundary-discipline.
     */
    async listResponses(pollId: string): Promise<ParticipantResponse[]> {
      throw new Error("not implemented");
    },

    async getResponseByTokenHash(hash: string): Promise<ParticipantResponse | undefined> {
      throw new Error("not implemented");
    },

    /** Replaces listParticipants on the public read path, which loaded every row to get a count. */
    async countRespondents(pollId: string): Promise<number> {
      throw new Error("not implemented");
    },

    // insertParticipant and updateParticipant gain `answered: EventConstraints`.
    //
    // bumpResultsVersion becomes a single statement:
    //   UPDATE polls SET results_version = results_version + 1 WHERE id = ? RETURNING results_version
    // Today's SELECT-then-UPDATE can lose an increment, which silently weakens the finalize CAS.
    // The freshness story this design leans on is only true once that read-modify-write is gone.
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * src/domain/commands.ts — new and changed methods on the single Commands registry
 * ──────────────────────────────────────────────────────────────────────────── */

type CommandContext = { store: Store & ReturnType<typeof storeAdditions> };

/**
 * Change what the poll offers. Allowed while the poll is live (open or closed); an edit never
 * changes status, so "close, review, widen the offer, reopen" is three explicit acts.
 *
 * Status is pre-checked here for a precise message and re-checked in the CAS for the race, the
 * same two-layer pattern finalize already uses.
 */
export async function updateEvent(
  ctx: CommandContext,
  input: UpdateEventInput,
): Promise<UpdateEventResult> {
  // TODO const poll = byOrganizerHash(input.organizerToken) ?? throw not_found
  //      if (poll.status === "finalized") throw closed  "A finalized poll's times are fixed. Delete it to start again."
  //      if (poll.status === "cancelled") throw closed  "A cancelled poll is not edited. Create a new poll."
  //      if (poll.eventVersion !== input.eventVersion) throw stale_version  (fast path; the CAS is authority)
  //      const revision = planRevision(current(poll), await store.listResponses(poll.id), input);
  //      await store.applyEventRevision(revision.write);
  //      return { eventVersion: revision.write.nextEventVersion, impact: revision.impact,
  //               receipt: revision.receipt };
  throw new Error("not implemented");
}

/**
 * Resume collection on a poll that was closed without a decision.
 *
 * closed -> open only. Idempotent on an already-open poll, mirroring close. Bumps nothing: no
 * constraint and no result changed, and finalizeIfFresh already accepts `open`, so there is no CAS
 * that needs invalidating. finalized and cancelled are refused, which is also why reopen never has
 * to clear finalizedStart/End (gotcha 8 cannot arise).
 */
export async function reopen(
  ctx: CommandContext,
  organizerToken: string,
): Promise<{ receipt: string }> {
  // TODO const poll = byOrganizerHash(organizerToken) ?? throw not_found
  //      if (poll.status === "open") return REOPENED;                       // idempotent
  //      if (poll.status !== "closed") throw closed(finalized ? "A finalized poll is not reopened…"
  //                                                           : "A cancelled poll is not reopened…")
  //      if (await store.setStatusIfIn(poll.id, "open", ["closed"])) return REOPENED;
  //      // lost a race: another actor moved it. Re-read; if it is open now, the caller's intent
  //      // holds, so return the same receipt rather than an error.
  //      return (await store.getPollById(poll.id))?.status === "open" ? REOPENED : throw conflict;
  throw new Error("not implemented");
}

// submitAvailability and updateAvailability gain the freshness gate and the stamp. The client
// proves which offer it saw; the server writes what it currently asks. The stamp is never taken
// from the request, so a client cannot claim to have evaluated time it never saw.
//
//   after the status gate, before validatePaintedIntervals:
//     if (input.eventVersion !== poll.eventVersion)
//       throw stale_version "The organizer changed the offered times. Reload this page and answer again."
//   then insertParticipant({ …, answered: { durationMinutes: poll.durationMinutes, windows } })
//
// updateAvailability is identical and re-stamps `answered`: re-posting against the current version
// *is* the act of re-evaluating, and it clears needsReevaluation. withdrawResponse leaves
// `answered` alone, since leaving is not an answer.

/* ────────────────────────────────────────────────────────────────────────────
 * src/http/schemas.ts
 * ──────────────────────────────────────────────────────────────────────────── */

// export const updateEventSchema = z.object({
//   eventVersion: z.number().int().min(1),
//   title: z.string().min(1).max(200).optional(),
//   context: z.string().max(2000).nullable().optional(),
//   location: z.string().max(500).nullable().optional(),
//   timezone: z.string().min(1).optional(),
//   durationMinutes: z.number().int().optional(),
//   windows: z.array(intervalSchema).optional(),
//   range: rangeSchema.optional(),
// }).refine((v) => !(v.windows && v.range), { message: "Provide windows or a range, not both." });
//
// submitSchema and updateSchema each gain `eventVersion: z.number().int().min(1)`.
//
// New in this change, and the reason the WebMCP organizer list could drift far enough to lose
// cancel_poll (gotcha 10): one request shape is currently hand-written three times.
//
//   export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
//     return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
//   }
//
// zod 4 is already a dependency. pages.tsx and openapi.ts call it instead of hand-writing JSON
// Schema for the new shapes, so update_event is described once. The existing descriptors can move
// over the same way; this change moves the ones it touches.

/* ────────────────────────────────────────────────────────────────────────────
 * Adapters — mechanical, listed so the fan-out is visible in one place
 *
 *   src/app.tsx
 *     POST /o/:token/update       form -> 303 /o/:token         (hidden eventVersion input)
 *     POST /api/organizer/:token/update   updateEventSchema.parse -> commands.updateEvent
 *     POST /o/:token/reopen       form -> 303 /o/:token
 *     POST /api/organizer/:token/reopen   commands.reopen
 *     Existing participant routes read eventVersion from the body / form.
 *
 *   src/http/pages.tsx
 *     OrganizerPage: edit card (title, context, location, duration, timezone, weekday range editor
 *       reused from CreatePage) + hidden eventVersion; Reopen button when status === "closed";
 *       a "needs re-evaluation" marker per respondent; WebMCP descriptors for update_event,
 *       reopen_poll, and cancel_poll (currently missing).
 *     InvitationPage / ParticipantPage: hidden eventVersion in the response form; ParticipantPage
 *       shows the re-confirm prompt when needsReevaluation.
 *
 *   src/mcp/tools.ts    update_event (updateEventSchema.extend({ organizerToken })), reopen_poll
 *   src/mcp/stdio.ts    updateEvent -> POST /api/organizer/${input.organizerToken}/update
 *                       reopen     -> POST /api/organizer/${token}/reopen
 *   src/http/openapi.ts 4 path entries, request bodies via jsonSchemaFor
 *
 * Tests (names chosen to avoid colliding with the existing PGlite persistence test
 * "reopens a poll from a PGlite data directory"):
 *   tests/revision.test.ts  planRevision over the five change classes, plus shrink-then-regrow
 *   tests/overlap.test.ts   three call sites reshape; expectations unchanged, plus added-window
 *                           scope and duration staleness
 *   tests/http.test.ts      "reopens collection on a closed poll", "refuses to reopen a cancelled
 *                           poll", "rejects an edit built on a stale eventVersion", "keeps answers
 *                           when the offer widens", "requires re-evaluation after a duration change"
 * ──────────────────────────────────────────────────────────────────────────── */
