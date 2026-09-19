import { Temporal } from "temporal-polyfill";
import { DomainError } from "./errors.ts";
import type { InstantIso, Interval } from "./types.ts";

export function nowIso(): InstantIso {
  return Temporal.Now.instant().toString();
}

export function parseInstant(value: string, label = "timestamp"): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new DomainError("validation", `Invalid ${label}: ${value}`);
  }
}

export function iso(instant: Temporal.Instant): InstantIso {
  return instant.toString();
}

export function parseInterval(interval: Interval): { start: Temporal.Instant; end: Temporal.Instant } {
  const start = parseInstant(interval.start, "start");
  const end = parseInstant(interval.end, "end");
  if (Temporal.Instant.compare(end, start) <= 0) {
    throw new DomainError("validation", "Each interval must end after it starts.");
  }
  return { start, end };
}

export function assertTimeZone(timeZone: string): string {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return timeZone;
  } catch {
    throw new DomainError("validation", `Unknown IANA time zone: ${timeZone}`);
  }
}

export function zonedLocal(
  timeZone: string,
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
): Temporal.ZonedDateTime {
  try {
    return Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: time.hour,
        minute: time.minute,
        second: 0,
        millisecond: 0,
      },
      { disambiguation: "reject" },
    );
  } catch {
    throw new DomainError(
      "validation",
      `Local time ${date.toString()} ${time.toString()} is ambiguous or nonexistent in ${timeZone}. Resolve it explicitly.`,
    );
  }
}

export function durationFromMinutes(minutes: number): Temporal.Duration {
  return Temporal.Duration.from({ minutes });
}

export function instantToDate(timeZone: string, instant: Temporal.Instant): string {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function formatLocal(timeZone: string, instantIso: InstantIso): string {
  const zdt = parseInstant(instantIso).toZonedDateTimeISO(timeZone);
  return zdt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function covers(
  outerStart: Temporal.Instant,
  outerEnd: Temporal.Instant,
  innerStart: Temporal.Instant,
  innerEnd: Temporal.Instant,
): boolean {
  return (
    Temporal.Instant.compare(outerStart, innerStart) <= 0 &&
    Temporal.Instant.compare(outerEnd, innerEnd) >= 0
  );
}

export function intervalInsideWindows(
  start: Temporal.Instant,
  end: Temporal.Instant,
  windows: Array<{ start: Temporal.Instant; end: Temporal.Instant }>,
): boolean {
  return windows.some((window) => covers(window.start, window.end, start, end));
}

export function spanDays(start: Temporal.Instant, end: Temporal.Instant): number {
  return (end.epochMilliseconds - start.epochMilliseconds) / 86_400_000;
}
