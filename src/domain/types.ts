export type PollStatus = "open" | "closed" | "finalized" | "cancelled";
export type AvailabilityState = "available" | "tentative" | "unavailable";
export type FourState = AvailabilityState | "unknown";
export type CoverageMode = "partial" | "remainder_unavailable";

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
};

export type CreatePollResult = {
  publicId: string;
  publicUrl: string;
  organizerToken: string;
  organizerUrl: string;
  eventVersion: number;
  resultsVersion: number;
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
  }>;
  tallies: SlotTally[];
  language: string;
};

export type SubmitAvailabilityInput = {
  publicId: string;
  name: string;
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
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
  intervals: AvailabilityInterval[];
  remainderUnavailable?: boolean;
};

export type FinalizeInput = {
  organizerToken: string;
  start: InstantIso;
  end: InstantIso;
  eventVersion: number;
  resultsVersion: number;
  note?: string;
};
