import { Temporal } from "temporal-polyfill";
import {
  MAX_DURATION_MINUTES,
  MAX_HORIZON_DAYS,
  MIN_DURATION_MINUTES,
  STEP_MINUTES,
} from "../config.ts";
import { DomainError } from "./errors.ts";
import {
  assertTimeZone,
  durationFromMinutes,
  iso,
  parseInterval,
  spanDays,
  zonedLocal,
} from "./time.ts";
import type { Candidate, ConstraintProposal, Constraints, Interval, RangeSpec, ValidConstraints } from "./types.ts";

export function upcomingWeekdayRange(
  timeZone: string,
  options?: { weekdayCount?: number; from?: Temporal.PlainDate },
): { startDate: string; endDate: string; minDate: string; maxDate: string } {
  assertTimeZone(timeZone);
  const weekdayCount = options?.weekdayCount ?? 5;
  const from = options?.from ?? Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  let start = from;
  while (start.dayOfWeek > 5) {
    start = start.add({ days: 1 });
  }
  let remaining = Math.max(1, weekdayCount) - 1;
  let end = start;
  while (remaining > 0) {
    end = end.add({ days: 1 });
    if (end.dayOfWeek <= 5) remaining -= 1;
  }
  return {
    startDate: start.toString(),
    endDate: end.toString(),
    minDate: from.toString(),
    maxDate: from.add({ days: MAX_HORIZON_DAYS }).toString(),
  };
}

export function assertDuration(durationMinutes: number): void {
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_DURATION_MINUTES ||
    durationMinutes > MAX_DURATION_MINUTES ||
    durationMinutes % STEP_MINUTES !== 0
  ) {
    throw new DomainError(
      "validation",
      `Duration must be ${MIN_DURATION_MINUTES}–${MAX_DURATION_MINUTES} minutes in ${STEP_MINUTES}-minute steps.`,
    );
  }
}

export function expandRange(timeZone: string, range: RangeSpec): Interval[] {
  assertTimeZone(timeZone);
  let startDate: Temporal.PlainDate;
  let endDate: Temporal.PlainDate;
  let dailyStart: Temporal.PlainTime;
  let dailyEnd: Temporal.PlainTime;
  try {
    startDate = Temporal.PlainDate.from(range.startDate);
    endDate = Temporal.PlainDate.from(range.endDate);
    dailyStart = Temporal.PlainTime.from(range.dailyStart);
    dailyEnd = Temporal.PlainTime.from(range.dailyEnd);
  } catch {
    throw new DomainError("validation", "Date range fields must use YYYY-MM-DD and HH:mm.");
  }
  if (Temporal.PlainDate.compare(endDate, startDate) < 0) {
    throw new DomainError("validation", "End date must be on or after start date.");
  }
  if (range.weekdays.length === 0) {
    throw new DomainError("validation", "Choose at least one weekday.");
  }
  if (range.weekdays.some((day) => day < 1 || day > 7)) {
    throw new DomainError("validation", "Weekdays must be ISO numbers 1 (Monday) through 7 (Sunday).");
  }
  if (Temporal.PlainTime.compare(dailyStart, dailyEnd) === 0) {
    throw new DomainError("validation", "Daily start and end cannot be the same time.");
  }

  const overnight = Temporal.PlainTime.compare(dailyEnd, dailyStart) < 0;
  const excluded = new Set(range.excludeDates ?? []);
  const windows: Interval[] = [];

  for (let date = startDate; Temporal.PlainDate.compare(date, endDate) <= 0; date = date.add({ days: 1 })) {
    if (excluded.has(date.toString())) continue;
    if (!range.weekdays.includes(date.dayOfWeek)) continue;
    const start = zonedLocal(timeZone, date, dailyStart).toInstant();
    const endDateForWindow = overnight ? date.add({ days: 1 }) : date;
    const end = zonedLocal(timeZone, endDateForWindow, dailyEnd).toInstant();
    windows.push({ start: iso(start), end: iso(end) });
  }

  if (windows.length === 0) {
    throw new DomainError(
      "validation",
      "None of the selected weekdays fall between those dates.",
    );
  }
  return windows;
}

export function normalizeWindows(windows: Interval[]): Array<{ start: Temporal.Instant; end: Temporal.Instant }> {
  if (windows.length === 0) {
    throw new DomainError("validation", "Provide at least one time window.");
  }
  const parsed = windows.map(parseInterval);
  parsed.sort((a, b) => Temporal.Instant.compare(a.start, b.start));
  const horizonStart = parsed[0]!.start;
  const horizonEnd = parsed.reduce(
    (max, window) => (Temporal.Instant.compare(window.end, max) > 0 ? window.end : max),
    parsed[0]!.end,
  );
  if (spanDays(horizonStart, horizonEnd) > MAX_HORIZON_DAYS) {
    throw new DomainError(
      "validation",
      `Candidate horizon cannot exceed ${MAX_HORIZON_DAYS} days.`,
    );
  }
  return parsed;
}

export function candidatesInWindows(
  windows: Interval[],
  durationMinutes: number,
  stepMinutes = STEP_MINUTES,
): Candidate[] {
  assertDuration(durationMinutes);
  const duration = durationFromMinutes(durationMinutes);
  const step = durationFromMinutes(stepMinutes);
  const parsedWindows = normalizeWindows(windows);
  const candidates: Candidate[] = [];

  for (const window of parsedWindows) {
    const lastStart = window.end.subtract(duration);
    if (Temporal.Instant.compare(lastStart, window.start) < 0) continue;
    for (
      let start = window.start;
      Temporal.Instant.compare(start, lastStart) <= 0;
      start = start.add(step)
    ) {
      const end = start.add(duration);
      candidates.push({ start: iso(start), end: iso(end) });
    }
  }

  if (candidates.length === 0) {
    throw new DomainError(
      "validation",
      `No ${durationMinutes}-minute meeting fits entirely inside the offered windows.`,
    );
  }
  return candidates;
}

export function parseConstraints(proposal: ConstraintProposal): ValidConstraints {
  assertDuration(proposal.durationMinutes);
  const timezone = assertTimeZone(proposal.timezone);
  const raw =
    proposal.windows && proposal.windows.length > 0
      ? proposal.windows
      : proposal.range
        ? expandRange(timezone, proposal.range)
        : (() => {
            throw new DomainError("validation", "Provide windows or a date range.");
          })();
  const windows = normalizeWindows(raw).map((window) => ({
    start: iso(window.start),
    end: iso(window.end),
  }));
  candidatesInWindows(windows, proposal.durationMinutes);
  return { durationMinutes: proposal.durationMinutes, windows } as ValidConstraints;
}

export function constraintsEqual(a: Constraints, b: Constraints): boolean {
  if (a.durationMinutes !== b.durationMinutes) return false;
  if (a.windows.length !== b.windows.length) return false;
  return a.windows.every(
    (window, index) => window.start === b.windows[index]!.start && window.end === b.windows[index]!.end,
  );
}
