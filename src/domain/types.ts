export type PollStatus = "open" | "closed" | "finalized" | "cancelled";
export type AvailabilityState = "available" | "tentative" | "unavailable";
export type FourState = AvailabilityState | "unknown";
export type CoverageMode = "partial" | "remainder_unavailable";

export const LIVE_STATUSES = ["open", "closed"] as const satisfies readonly PollStatus[];
export const REOPENABLE_STATUSES = ["closed", "cancelled"] as const satisfies readonly PollStatus[];

export type InstantIso = string;

export type Interval = {
  start: InstantIso;
  end: InstantIso;
};

export type AvailabilityInterval = Interval & {
  state: AvailabilityState;
};

export type Candidate = Interval;

export type RangeSpec = {
  startDate: string;
  endDate: string;
  weekdays: number[];
  dailyStart: string;
  dailyEnd: string;
  excludeDates?: string[];
};

export type CreatePollInput = {
  title: string;
  context?: string;
  location?: string;
  durationMinutes: number;
  timezone: string;
  windows?: Interval[];
  range?: RangeSpec;
  idempotencyKey?: string;
};

export type CreatePollResult = {
  publicId: string;
  publicUrl: string;
  organizerToken: string;
  organizerUrl: string;
  eventVersion: number;
  resultsVersion: number;
};

export type Constraints = {
  durationMinutes: number;
  windows: Interval[];
};

declare const VALID: unique symbol;

export type ValidConstraints = Constraints & { readonly [VALID]: true };

export type EventConstraints = Constraints & { eventVersion: number };

export type Answer = {
  evaluated: EventConstraints;
  coverageMode: CoverageMode;
  intervals: AvailabilityInterval[];
};

export type Participant = {
  id: string;
  pollId: string;
  displayName: string;
  withdrawn: boolean;
  responseVersion: number;
  updatedAt: InstantIso;
  answer: Answer;
};

export type Staleness = "current" | "windows_changed" | "reevaluation_required";

export type ConstraintProposal = {
  durationMinutes: number;
  timezone: string;
  windows?: Interval[];
  range?: RangeSpec;
};

export type PollMetadata = {
  title: string;
  context: string | null;
  location: string | null;
  timezone: string;
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
  constraintsChanged: boolean;
  receipt: string;
};

export type PublicEvent = {
  publicId: string;
  title: string;
  context: string | null;
  location: string | null;
  durationMinutes: number;
  stepMinutes: number;
  timezone: string;
  status: PollStatus;
  eventVersion: number;
  windows: Interval[];
  candidates: Candidate[];
  respondentCount: number;
  finalized: Interval | null;
  disclosure: string;
};

export type ParticipantView = PublicEvent & {
  responseId: string;
  displayName: string;
  coverageMode: CoverageMode;
  withdrawn: boolean;
  responseVersion: number;
  intervals: AvailabilityInterval[];
  evaluated: EventConstraints;
  staleness: Staleness;
};

export type SlotTally = {
  start: InstantIso;
  end: InstantIso;
  available: number;
  tentative: number;
  unavailable: number;
  unknown: number;
  fullSupport: boolean;
};

export type OrganizerEvent = PublicEvent & {
  eventVersion: number;
  resultsVersion: number;
  participants: Array<{
    responseId: string;
    displayName: string;
    withdrawn: boolean;
    coverageMode: CoverageMode;
    updatedAt: InstantIso;
    intervals: AvailabilityInterval[];
    evaluatedEventVersion: number;
    staleness: Staleness;
  }>;
  tallies: SlotTally[];
  language: string;
};

export type SubmitAvailabilityInput = {
  publicId: string;
  name: string;
  eventVersion: number;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
  idempotencyKey?: string;
};

export type SubmitAvailabilityResult = {
  responseToken: string;
  responseUrl: string;
  responseVersion: number;
  receipt: string;
};

export type UpdateAvailabilityInput = {
  responseToken: string;
  responseVersion: number;
  eventVersion: number;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
  idempotencyKey?: string;
};

export type UpdateAvailabilityResult = {
  responseVersion: number;
  receipt: string;
};

export type WithdrawResponseInput = {
  responseToken: string;
  responseVersion: number;
  idempotencyKey?: string;
};

export type WithdrawResponseResult = {
  receipt: string;
};

export type FinalizeInput = {
  organizerToken: string;
  start: InstantIso;
  end: InstantIso;
  eventVersion: number;
  resultsVersion: number;
  note?: string;
};
