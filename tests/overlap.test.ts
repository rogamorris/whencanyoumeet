import { describe, expect, it } from "vitest";
import { effectiveState, tallyCandidates } from "../src/domain/overlap.ts";

describe("overlap", () => {
  const hour = {
    start: "2026-09-21T13:00:00Z",
    end: "2026-09-21T14:00:00Z",
  };

  it("does not treat two short fragments as a 60-minute yes", () => {
    const state = effectiveState(
      [
        { start: "2026-09-21T13:00:00Z", end: "2026-09-21T13:30:00Z", state: "available" },
        { start: "2026-09-21T13:30:00Z", end: "2026-09-21T13:45:00Z", state: "unavailable" },
        { start: "2026-09-21T13:45:00Z", end: "2026-09-21T14:00:00Z", state: "available" },
      ],
      hour,
      "partial",
    );
    expect(state).toBe("unknown");
  });

  it("keeps unknown distinct from unavailable", () => {
    expect(effectiveState([], hour, "partial")).toBe("unknown");
    expect(effectiveState([], hour, "remainder_unavailable")).toBe("unavailable");
  });

  it("requires every respondent to be available for full support", () => {
    const tallies = tallyCandidates(
      [hour],
      [
        {
          withdrawn: false,
          coverageMode: "partial",
          intervals: [{ ...hour, state: "available" }],
        },
        {
          withdrawn: false,
          coverageMode: "partial",
          intervals: [{ ...hour, state: "tentative" }],
        },
      ],
    );
    expect(tallies[0]?.fullSupport).toBe(false);
    expect(tallies[0]?.available).toBe(1);
    expect(tallies[0]?.tentative).toBe(1);
  });
});
