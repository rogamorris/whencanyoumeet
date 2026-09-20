import { Temporal } from "temporal-polyfill";
import { DomainError } from "./errors.ts";
import { covers, intervalInsideWindows, parseInstant, parseInterval } from "./time.ts";
import type {
  Answer,
  AvailabilityInterval,
  AvailabilityState,
  Candidate,
  EventConstraints,
  FourState,
  Interval,
  Participant,
  SlotTally,
  Staleness,
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
  answer: Answer,
  candidate: Candidate,
  current: EventConstraints,
): FourState {
  if (answer.evaluated.durationMinutes !== current.durationMinutes) return "unknown";
  const painted = stateForCandidate(answer.intervals, candidate);
  if (painted !== "unknown") return painted;
  if (
    answer.coverageMode === "remainder_unavailable" &&
    intervalInsideWindows(
      parseInstant(candidate.start),
      parseInstant(candidate.end),
      answer.evaluated.windows.map(parseInterval),
    )
  ) {
    return "unavailable";
  }
  return "unknown";
}

export function staleness(answer: Answer, current: EventConstraints): Staleness {
  if (answer.evaluated.durationMinutes !== current.durationMinutes) return "reevaluation_required";
  if (answer.evaluated.eventVersion !== current.eventVersion) return "windows_changed";
  return "current";
}

export function tallyCandidates(
  candidates: Candidate[],
  participants: Array<Pick<Participant, "withdrawn" | "answer">>,
  current: EventConstraints,
): SlotTally[] {
  const active = participants.filter((participant) => !participant.withdrawn);
  return candidates.map((candidate) => {
    const counts = { available: 0, tentative: 0, unavailable: 0, unknown: 0 };
    for (const participant of active) {
      counts[effectiveState(participant.answer, candidate, current)] += 1;
    }
    const n = active.length;
    return {
      ...candidate,
      ...counts,
      fullSupport: n > 0 && counts.available === n,
    };
  });
}

export function remapPaintedAnswers(
  intervals: AvailabilityInterval[],
  candidates: Candidate[],
): Map<string, AvailabilityState> {
  const mapped = new Map<string, AvailabilityState>();
  for (const candidate of candidates) {
    const state = stateForCandidate(intervals, candidate);
    if (state === "unknown") continue;
    mapped.set(`${candidate.start}|${candidate.end}`, state);
  }
  return mapped;
}

export function sortTallies(tallies: SlotTally[]): SlotTally[] {
  return [...tallies].sort((a, b) => {
    if (a.fullSupport !== b.fullSupport) return a.fullSupport ? -1 : 1;
    if (a.available !== b.available) return b.available - a.available;
    return Temporal.Instant.compare(parseInstant(a.start), parseInstant(b.start));
  });
}

export function resultsLanguage(respondentCount: number, reevaluationRequired: number): string {
  if (respondentCount === 0) return "No responses yet. These counts describe respondents, not all invitees.";
  const base = `Counts describe all ${respondentCount} respondent${respondentCount === 1 ? "" : "s"}, not an unknown invitation list.`;
  if (reevaluationRequired === 0) return base;
  const verb = reevaluationRequired === 1 ? "has" : "have";
  return `${base} ${reevaluationRequired} ${verb} not re-evaluated since the duration changed.`;
}
