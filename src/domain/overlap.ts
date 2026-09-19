import { Temporal } from "temporal-polyfill";
import { DomainError } from "./errors.ts";
import { covers, intervalInsideWindows, parseInstant, parseInterval } from "./time.ts";
import type {
  AvailabilityInterval,
  AvailabilityState,
  Candidate,
  CoverageMode,
  FourState,
  Interval,
  SlotTally,
} from "./types.ts";
import { MAX_INTERVALS_PER_RESPONSE } from "../config.ts";

const STATE_RANK: Record<AvailabilityState, number> = {
  unavailable: 3,
  tentative: 2,
  available: 1,
};

export function validatePaintedIntervals(
  intervals: AvailabilityInterval[],
  windows: Interval[],
): AvailabilityInterval[] {
  if (intervals.length > MAX_INTERVALS_PER_RESPONSE) {
    throw new DomainError("limit", `At most ${MAX_INTERVALS_PER_RESPONSE} intervals per response.`);
  }
  const parsedWindows = windows.map(parseInterval);
  for (const interval of intervals) {
    const { start, end } = parseInterval(interval);
    if (!intervalInsideWindows(start, end, parsedWindows)) {
      throw new DomainError(
        "out_of_range",
        "Availability must sit inside the poll's offered windows.",
        interval,
      );
    }
  }
  return intervals;
}

export function stateForCandidate(
  intervals: AvailabilityInterval[],
  candidate: Candidate,
): FourState {
  const start = parseInstant(candidate.start);
  const end = parseInstant(candidate.end);
  const covering = intervals.filter((interval) => {
    const painted = parseInterval(interval);
    return covers(painted.start, painted.end, start, end);
  });
  if (covering.length === 0) return "unknown";
  return covering.sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state])[0]!.state;
}

export function effectiveState(
  intervals: AvailabilityInterval[],
  candidate: Candidate,
  coverageMode: CoverageMode,
): FourState {
  const state = stateForCandidate(intervals, candidate);
  if (state === "unknown" && coverageMode === "remainder_unavailable") return "unavailable";
  return state;
}

export function tallyCandidates(
  candidates: Candidate[],
  participants: Array<{
    withdrawn: boolean;
    coverageMode: CoverageMode;
    intervals: AvailabilityInterval[];
  }>,
): SlotTally[] {
  const active = participants.filter((participant) => !participant.withdrawn);
  return candidates.map((candidate) => {
    const counts = { available: 0, tentative: 0, unavailable: 0, unknown: 0 };
    for (const participant of active) {
      counts[effectiveState(participant.intervals, candidate, participant.coverageMode)] += 1;
    }
    const n = active.length;
    return {
      ...candidate,
      ...counts,
      fullSupport: n > 0 && counts.available === n,
    };
  });
}

export function sortTallies(tallies: SlotTally[]): SlotTally[] {
  return [...tallies].sort((a, b) => {
    if (a.fullSupport !== b.fullSupport) return a.fullSupport ? -1 : 1;
    if (a.available !== b.available) return b.available - a.available;
    return Temporal.Instant.compare(parseInstant(a.start), parseInstant(b.start));
  });
}

export function resultsLanguage(respondentCount: number): string {
  if (respondentCount === 0) return "No responses yet. These counts describe respondents, not all invitees.";
  return `Counts describe all ${respondentCount} respondent${respondentCount === 1 ? "" : "s"}, not an unknown invitation list.`;
}
