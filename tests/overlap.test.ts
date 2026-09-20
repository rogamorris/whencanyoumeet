import { describe, expect, it } from "vitest";
import { effectiveState, tallyCandidates } from "../src/domain/overlap.ts";

describe("overlap", () => {
  const hour = {
    start: "2026-09-21T13:00:00Z",
    end: "2026-09-21T14:00:00Z",
  };
  const window = {
    start: "2026-09-21T13:00:00Z",
    end: "2026-09-21T21:00:00Z",
  };
  const current = { eventVersion: 1, durationMinutes: 60, windows: [window] };
  const outside = {
    start: "2026-09-25T13:00:00Z",
    end: "2026-09-25T14:00:00Z",
  };

  it("does not treat two short fragments as a 60-minute yes", () => {
    const state = effectiveState(
      {
        evaluated: current,
        coverageMode: "partial",
        intervals: [
          { start: "2026-09-21T13:00:00Z", end: "2026-09-21T13:30:00Z", state: "available" },
          { start: "2026-09-21T13:30:00Z", end: "2026-09-21T13:45:00Z", state: "unavailable" },
          { start: "2026-09-21T13:45:00Z", end: "2026-09-21T14:00:00Z", state: "available" },
        ],
      },
      hour,
      current,
    );
    expect(state).toBe("unknown");
  });

  it("keeps unknown distinct from unavailable", () => {
    const emptyPartial = { evaluated: current, coverageMode: "partial" as const, intervals: [] };
    const emptyRemainder = {
      evaluated: current,
      coverageMode: "remainder_unavailable" as const,
      intervals: [],
    };
    expect(effectiveState(emptyPartial, hour, current)).toBe("unknown");
    expect(effectiveState(emptyRemainder, hour, current)).toBe("unavailable");
    expect(effectiveState(emptyRemainder, outside, current)).toBe("unknown");
  });

  it("requires every respondent to be available for full support", () => {
    const tallies = tallyCandidates(
      [hour],
      [
        {
          withdrawn: false,
          answer: {
            evaluated: current,
            coverageMode: "partial",
            intervals: [{ ...hour, state: "available" }],
          },
        },
        {
          withdrawn: false,
          answer: {
            evaluated: current,
            coverageMode: "partial",
            intervals: [{ ...hour, state: "tentative" }],
          },
        },
      ],
      current,
    );
    expect(tallies[0]?.fullSupport).toBe(false);
    expect(tallies[0]?.available).toBe(1);
    expect(tallies[0]?.tentative).toBe(1);
  });
});
