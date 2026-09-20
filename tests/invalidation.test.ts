import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { effectiveState, remapPaintedAnswers, staleness } from "../src/domain/overlap.ts";
import { constraintsEqual, parseConstraints } from "../src/domain/windows.ts";

const mon = { start: "2026-09-21T13:00:00Z", end: "2026-09-21T21:00:00Z" };
const fri = { start: "2026-09-25T13:00:00Z", end: "2026-09-25T21:00:00Z" };
const mon13 = { start: "2026-09-21T17:00:00Z", end: "2026-09-21T18:00:00Z" };
const mon10 = { start: "2026-09-21T14:00:00Z", end: "2026-09-21T15:00:00Z" };
const fri10 = { start: "2026-09-25T14:00:00Z", end: "2026-09-25T15:00:00Z" };
const mon1330 = { start: "2026-09-21T17:00:00Z", end: "2026-09-21T17:30:00Z" };

const v1 = { eventVersion: 1, durationMinutes: 60, windows: [mon] };
const v2 = { eventVersion: 2, durationMinutes: 60, windows: [mon, fri] };
const v3 = { eventVersion: 3, durationMinutes: 30, windows: [mon] };

const alex = {
  evaluated: v1,
  coverageMode: "remainder_unavailable" as const,
  intervals: [{ ...mon13, state: "available" as const }],
};

describe("invalidation", () => {
  it("keeps a covering paint when constraints are unchanged", () => {
    expect(effectiveState(alex, mon13, v1)).toBe("available");
  });

  it("marks the unpainted remainder unavailable only inside the evaluated windows", () => {
    expect(effectiveState(alex, mon10, v1)).toBe("unavailable");
  });

  it("returns unknown for a window added after the answer, even with remainder_unavailable", () => {
    expect(effectiveState(alex, fri10, v2)).toBe("unknown");
  });

  it("keeps answers for windows that survive a shrink", () => {
    const shrunk = { eventVersion: 2, durationMinutes: 60, windows: [mon] };
    expect(effectiveState(alex, mon13, shrunk)).toBe("available");
  });

  it("returns unknown for every candidate after a duration decrease", () => {
    expect(effectiveState(alex, mon1330, v3)).toBe("unknown");
    expect(effectiveState(alex, mon13, v3)).toBe("unknown");
  });

  it("returns unknown for every candidate after a duration increase", () => {
    const longer = { eventVersion: 4, durationMinutes: 90, windows: [mon] };
    const wide = {
      evaluated: v1,
      coverageMode: "partial" as const,
      intervals: [{ ...mon, state: "available" as const }],
    };
    expect(effectiveState(alex, mon13, longer)).toBe("unknown");
    expect(effectiveState(wide, mon13, longer)).toBe("unknown");
  });

  it("distinguishes current, windows_changed, and reevaluation_required", () => {
    expect(staleness(alex, v1)).toBe("current");
    expect(staleness(alex, v2)).toBe("windows_changed");
    expect(staleness(alex, v3)).toBe("reevaluation_required");
  });

  it("canonicalizes and sorts windows and rejects a duration no window can hold", () => {
    const parsed = parseConstraints({
      durationMinutes: 60,
      timezone: "America/New_York",
      windows: [fri, mon],
    });
    expect(parsed.windows).toEqual([mon, fri]);
    expect(() =>
      parseConstraints({
        durationMinutes: 240,
        timezone: "UTC",
        windows: [{ start: "2026-09-21T13:00:00Z", end: "2026-09-21T14:00:00Z" }],
      }),
    ).toThrow(DomainError);
    try {
      parseConstraints({
        durationMinutes: 240,
        timezone: "UTC",
        windows: [{ start: "2026-09-21T13:00:00Z", end: "2026-09-21T14:00:00Z" }],
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "validation",
        message: "No 240-minute meeting fits entirely inside the offered windows.",
      });
    }
  });

  it("treats reordered or differently formatted identical windows as equal", () => {
    const a = parseConstraints({
      durationMinutes: 60,
      timezone: "UTC",
      windows: [mon, fri],
    });
    const b = parseConstraints({
      durationMinutes: 60,
      timezone: "UTC",
      windows: [
        { start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T21:00:00.000Z" },
        { start: "2026-09-21T13:00:00.000Z", end: "2026-09-21T21:00:00.000Z" },
      ],
    });
    expect(constraintsEqual(a, b)).toBe(true);
    expect(constraintsEqual(a, { durationMinutes: 30, windows: a.windows })).toBe(false);
  });

  it("maps covering paints onto candidates with Temporal covers, not string compare", () => {
    const painted = [{ start: "2026-09-21T13:00:00.000Z", end: "2026-09-21T18:00:00.000Z", state: "available" as const }];
    const mapped = remapPaintedAnswers(painted, [mon13, fri10]);
    expect(mapped.get("2026-09-21T17:00:00Z|2026-09-21T18:00:00Z")).toBe("available");
    expect(mapped.has("2026-09-25T14:00:00Z|2026-09-25T15:00:00Z")).toBe(false);
  });
});
