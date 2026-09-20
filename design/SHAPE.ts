/*
Proposed module map.

src/domain/types.ts owns the public command inputs, results, and views below.
src/domain/event-update.ts owns canonicalization, edit classification, answer invalidation,
and candidate continuity. It exports planEventUpdate as its only command-facing operation.
src/domain/windows.ts returns a canonical CandidateSet with duplicate intervals removed.
src/domain/overlap.ts applies candidate continuity before explicit paints or coverageMode.
src/domain/commands.ts adds updateEvent and reopen, then delegates one atomic write to Store.
src/db/schema.ts adds participant answer-version columns and candidate_continuity.
src/db/migrate.ts backfills every existing participant and current candidate at event version 1.
src/db/store.ts adds updateEventIfFresh, reopenIfClosed, and commitAnswerIfCurrent.
src/http/schemas.ts owns the zod schema and its JSON Schema conversion.
src/app.tsx, src/http/pages.tsx, src/mcp/tools.ts, src/mcp/stdio.ts, and
src/http/openapi.ts stay as thin adapters over Commands.
*/

declare const eventVersionBrand: unique symbol;
declare const resultsVersionBrand: unique symbol;
declare const responseVersionBrand: unique symbol;
declare const candidateKeyBrand: unique symbol;

export type EventVersion = number & { readonly [eventVersionBrand]: true };
export type ResultsVersion = number & { readonly [resultsVersionBrand]: true };
export type ResponseVersion = number & { readonly [responseVersionBrand]: true };
export type CandidateKey = string & { readonly [candidateKeyBrand]: true };

export type PollStatus = "open" | "closed" | "finalized" | "cancelled";
export type AvailabilityState = "available" | "tentative" | "unavailable";
export type FourState = AvailabilityState | "unknown";
export type CoverageMode = "partial" | "remainder_unavailable";
export type InstantIso = string;

export type Interval = {
	start: InstantIso;
	end: InstantIso;
};

export type Candidate = Interval;

export type AvailabilityInterval = Interval & {
	state: AvailabilityState;
};

export type RangeSpec = {
	startDate: string;
	endDate: string;
	weekdays: number[];
	dailyStart: string;
	dailyEnd: string;
	excludeDates?: string[];
};

/*
The boundary accepts either a complete absolute replacement or a fresh range.
CanonicalEventDefinition contains only concrete UTC windows.
*/
export type ConstraintReplacement =
	| {
			kind: "windows";
			windows: readonly Interval[];
	  }
	| {
			kind: "range";
			range: RangeSpec;
	  };

/*
This is a replacement, not a partial patch. A caller reads the event, changes fields,
and sends the complete proposed definition with the version it read.
*/
export type EventReplacement = {
	title: string;
	context: string | null;
	location: string | null;
	durationMinutes: number;
	timezone: string;
	constraints: ConstraintReplacement;
};

export type UpdateEventInput = {
	organizerToken: string;
	eventVersion: EventVersion;
	event: EventReplacement;
};

export type ReevaluationReason = "duration" | "title" | "context" | "location";

export type AnswerEffect =
	| {
			kind: "unchanged";
	  }
	| {
			kind: "retained_on_continuous_candidates";
			addedCandidateCount: number;
			removedCandidateCount: number;
	  }
	| {
			kind: "requires_reevaluation";
			reasons: readonly [ReevaluationReason, ...ReevaluationReason[]];
			affectedParticipants: number;
	  };

export type UpdateEventResult = {
	status: "open" | "closed";
	eventVersion: EventVersion;
	resultsVersion: ResultsVersion;
	answerEffect: AnswerEffect;
	receipt: string;
};

export type ReopenResult = {
	status: "open";
	receipt: string;
};

/*
All participant mutations carry the event version that supplied their candidates.
The store checks status and eventVersion in the same transaction that changes answers.
*/
export type SubmitAvailabilityInput = {
	publicId: string;
	eventVersion: EventVersion;
	name: string;
	intervals: AvailabilityInterval[];
	remainderUnavailable?: boolean;
};

export type UpdateAvailabilityInput = {
	responseToken: string;
	eventVersion: EventVersion;
	responseVersion: ResponseVersion;
	intervals: AvailabilityInterval[];
	remainderUnavailable?: boolean;
};

export type WithdrawResponseInput = {
	responseToken: string;
	eventVersion: EventVersion;
	responseVersion: ResponseVersion;
};

export type AnswerFreshness =
	| {
			kind: "current";
	  }
	| {
			kind: "has_new_candidates";
			newCandidateCount: number;
	  }
	| {
			kind: "requires_reevaluation";
			invalidatedAtEventVersion: EventVersion;
	  };

export type ParticipantAnswerView = {
	answeredEventVersion: EventVersion;
	responseVersion: ResponseVersion;
	coverageMode: CoverageMode;
	intervals: AvailabilityInterval[];
	freshness: AnswerFreshness;
	candidateStates: Array<Candidate & { state: FourState }>;
};

export type OrganizerParticipantView = {
	responseId: string;
	displayName: string;
	withdrawn: boolean;
	updatedAt: InstantIso;
	answer: ParticipantAnswerView;
};

export type CommandsAdditions = {
	updateEvent(input: UpdateEventInput): Promise<UpdateEventResult>;
	reopen(organizerToken: string): Promise<ReopenResult>;
	submitAvailability(input: SubmitAvailabilityInput): Promise<{
		responseToken: string;
		responseUrl: string;
		responseVersion: ResponseVersion;
		receipt: string;
	}>;
	updateAvailability(input: UpdateAvailabilityInput): Promise<{
		responseVersion: ResponseVersion;
		receipt: string;
	}>;
	withdrawResponse(input: WithdrawResponseInput): Promise<{ receipt: string }>;
};

/*
Internal domain shapes start here. Transport adapters do not import these types.
*/

export type CanonicalInterval = Interval & {
	readonly __canonicalUtcInterval: true;
};

export type CandidateSet = ReadonlyMap<CandidateKey, Candidate>;

export type CanonicalEventDefinition = {
	title: string;
	context: string | null;
	location: string | null;
	durationMinutes: number;
	timezone: string;
	windows: readonly [CanonicalInterval, ...CanonicalInterval[]];
	candidates: CandidateSet;
};

/*
One row exists for each current candidate. introducedEventVersion records when that
exact start and end pair most recently entered the continuously offered candidate set.
Deleting and later re-adding a candidate assigns a new introducedEventVersion.
*/
export type CandidateContinuity = {
	key: CandidateKey;
	start: InstantIso;
	end: InstantIso;
	introducedEventVersion: EventVersion;
};

export type ParticipantAnswer = {
	participantId: string;
	withdrawn: boolean;
	answeredEventVersion: EventVersion;
	invalidatedAtEventVersion: EventVersion | null;
	coverageMode: CoverageMode;
	intervals: readonly AvailabilityInterval[];
};

export type EditableEventState = {
	pollId: string;
	status: "open" | "closed";
	eventVersion: EventVersion;
	resultsVersion: ResultsVersion;
	event: CanonicalEventDefinition;
	candidateContinuity: ReadonlyMap<CandidateKey, CandidateContinuity>;
	participantCount: number;
};

export type NoopEventUpdate = {
	kind: "noop";
	current: EditableEventState;
	result: UpdateEventResult;
};

export type PreserveAnswers = {
	kind: "preserve_answers";
	effect: Extract<AnswerEffect, { kind: "unchanged" | "retained_on_continuous_candidates" }>;
};

export type InvalidateAnswers = {
	kind: "invalidate_answers";
	effect: Extract<AnswerEffect, { kind: "requires_reevaluation" }>;
};

export type CommittedEventUpdate = {
	kind: "commit";
	pollId: string;
	expectedEventVersion: EventVersion;
	nextEventVersion: EventVersion;
	expectedStatus: "open" | "closed";
	nextEvent: CanonicalEventDefinition;
	nextCandidateContinuity: readonly CandidateContinuity[];
	answerPolicy: PreserveAnswers | InvalidateAnswers;
};

export type EventUpdatePlan = NoopEventUpdate | CommittedEventUpdate;

/*
The boundary parser trims text, parses the timezone and instants, expands a range,
sorts and canonicalizes windows, derives candidates, and rejects an empty result.
*/
export function canonicalizeEventReplacement(
	input: EventReplacement,
): CanonicalEventDefinition {
	throw new Error("not implemented");
}

/*
Every actual field change consumes one event version.

An expectedEventVersion mismatch fails before no-op detection.
Title, context, location, or duration changes choose invalidate_answers.
A window-only change preserves exact candidate keys that exist before and after.
A timezone-only change preserves all candidate continuity.
*/
export function planEventUpdate(
	current: EditableEventState,
	expectedEventVersion: EventVersion,
	proposed: CanonicalEventDefinition,
): EventUpdatePlan {
	throw new Error("not implemented");
}

/*
Preserve mode carries the old introduced version for an exact retained candidate.
It assigns nextEventVersion to a new or re-added candidate. Invalidate mode assigns
nextEventVersion to every candidate.
*/
export function reconcileCandidateContinuity(
	current: ReadonlyMap<CandidateKey, CandidateContinuity>,
	nextCandidates: CandidateSet,
	nextEventVersion: EventVersion,
	mode: "preserve" | "invalidate",
): readonly CandidateContinuity[] {
	throw new Error("not implemented");
}

/*
The continuity check runs before geometry. An old wide paint and
remainder_unavailable cannot affect a candidate introduced after the answer.
*/
export function effectiveStateForCandidate(
	answer: ParticipantAnswer,
	candidate: CandidateContinuity,
): FourState {
	throw new Error("not implemented");
}

export function freshnessForAnswer(
	answer: ParticipantAnswer,
	candidates: readonly CandidateContinuity[],
): AnswerFreshness {
	throw new Error("not implemented");
}

/*
Persistence shapes.

candidate_continuity has primary key (poll_id, start_at, end_at).
participants adds answered_event_version NOT NULL and
invalidated_at_event_version NULL.
*/
export type CandidateContinuityRow = {
	pollId: string;
	startAt: InstantIso;
	endAt: InstantIso;
	introducedEventVersion: number;
};

export type ParticipantAnswerVersionColumns = {
	answeredEventVersion: number;
	invalidatedAtEventVersion: number | null;
};

export type EventUpdateCommit = {
	plan: CommittedEventUpdate;
};

export type EventUpdateCommitResult =
	| {
			kind: "updated";
			status: "open" | "closed";
			eventVersion: EventVersion;
			resultsVersion: ResultsVersion;
	  }
	| {
			kind: "stale_event";
	  }
	| {
			kind: "not_editable";
			status: "finalized" | "cancelled";
	  };

export type ReopenStoreResult =
	| { kind: "reopened" }
	| { kind: "already_open" }
	| { kind: "not_reopenable"; status: "finalized" | "cancelled" }
	| { kind: "not_found" };

export type AnswerMutation =
	| {
			kind: "submit";
			pollId: string;
			displayName: string;
			responseTokenHash: string;
			coverageMode: CoverageMode;
			intervals: readonly AvailabilityInterval[];
	  }
	| {
			kind: "update";
			pollId: string;
			participantId: string;
			expectedResponseVersion: ResponseVersion;
			coverageMode: CoverageMode;
			intervals: readonly AvailabilityInterval[];
	  }
	| {
			kind: "withdraw";
			pollId: string;
			participantId: string;
			expectedResponseVersion: ResponseVersion;
	  };

export type AnswerCommitResult =
	| {
			kind: "committed";
			resultsVersion: ResultsVersion;
			responseVersion: ResponseVersion;
	  }
	| { kind: "stale_event" }
	| { kind: "stale_response" }
	| { kind: "closed" };

export interface StoreAdditions {
	/*
	This method runs one database transaction. It compare-and-swaps the poll row,
	replaces windows and candidate_continuity, and applies answer invalidation.
	Invalidation deletes intervals, changes coverageMode to partial, increments each
	responseVersion, sets invalidatedAtEventVersion, and increments resultsVersion once.
	*/
	updateEventIfFresh(input: EventUpdateCommit): Promise<EventUpdateCommitResult>;

	/*
	This is one guarded status transition. It never changes eventVersion or resultsVersion.
	*/
	reopenIfClosed(pollId: string): Promise<ReopenStoreResult>;

	/*
	The transaction first increments resultsVersion with a poll-row predicate for open
	status and expectedEventVersion. It then writes the participant and intervals.
	A concurrent finalize either wins first or observes the incremented resultsVersion.
	*/
	commitAnswerIfCurrent(
		expectedEventVersion: EventVersion,
		mutation: AnswerMutation,
	): Promise<AnswerCommitResult>;

	listCandidateContinuity(pollId: string): Promise<readonly CandidateContinuity[]>;
}

/*
Private transaction helpers in src/db/store.ts. They are not Store methods.
*/
export type DbTransaction = unknown;

export function replaceWindowsTx(
	tx: DbTransaction,
	pollId: string,
	windows: readonly CanonicalInterval[],
): Promise<void> {
	throw new Error("not implemented");
}

export function replaceCandidateContinuityTx(
	tx: DbTransaction,
	pollId: string,
	candidates: readonly CandidateContinuity[],
): Promise<void> {
	throw new Error("not implemented");
}

export function invalidateParticipantAnswersTx(
	tx: DbTransaction,
	pollId: string,
	atEventVersion: EventVersion,
): Promise<number> {
	throw new Error("not implemented");
}

/*
src/http/schemas.ts exports updateEventSchema and updateEventJsonSchema.
JSON routes and MCP use the zod schema. WebMCP and OpenAPI use the JSON Schema
converted from that same zod value. Reopen uses the shared empty-object schema.
*/
export interface EventEditAdapterContract {
	json: {
		update: "POST /api/organizer/:token/update";
		reopen: "POST /api/organizer/:token/reopen";
	};
	html: {
		update: "POST /o/:token/update";
		reopen: "POST /o/:token/reopen";
	};
	mcp: {
		update: "update_event";
		reopen: "reopen_poll";
	};
	commands: CommandsAdditions;
}
