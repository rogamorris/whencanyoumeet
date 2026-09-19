import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { candidatesInWindows, expandRange, upcomingWeekdayRange } from "../src/domain/windows.ts";

describe("window expansion", () => {
  it("defaults to the next five weekdays", async () => {
    const { Temporal } = await import("temporal-polyfill");
    const saturday = Temporal.PlainDate.from("2026-09-19");
    expect(upcomingWeekdayRange("America/New_York", { from: saturday })).toEqual({
      startDate: "2026-09-21",
      endDate: "2026-09-25",
      minDate: "2026-09-19",
      maxDate: "2026-11-18",
    });
    const wednesday = Temporal.PlainDate.from("2026-09-23");
    expect(upcomingWeekdayRange("America/New_York", { from: wednesday }).startDate).toBe(
      "2026-09-23",
    );
    expect(upcomingWeekdayRange("America/New_York", { from: wednesday }).endDate).toBe("2026-09-29");
  });

  it("builds weekday windows in the authored zone", () => {
    const windows = expandRange("America/New_York", {
      startDate: "2026-09-21",
      endDate: "2026-09-25",
      weekdays: [1, 2, 3, 4, 5],
      dailyStart: "09:00",
      dailyEnd: "18:00",
    });
    expect(windows).toHaveLength(5);
    const candidates = candidatesInWindows(windows, 60);
    expect(candidates[0]?.start).toBe("2026-09-21T13:00:00Z");
    expect(candidates[0]?.end).toBe("2026-09-21T14:00:00Z");
    expect(candidates.some((slot) => slot.start === "2026-09-21T21:30:00Z")).toBe(false);
    expect(candidates.some((slot) => slot.start === "2026-09-21T21:00:00Z")).toBe(true);
  });

  it("rejects a 60-minute meeting that would start too late in the window", () => {
    const windows = [{ start: "2026-09-21T13:00:00Z", end: "2026-09-21T14:00:00Z" }];
    const candidates = candidatesInWindows(windows, 60);
    expect(candidates.map((slot) => slot.start)).toEqual(["2026-09-21T13:00:00Z"]);
  });

  it("rejects nonexistent local times at a DST spring-forward", () => {
    expect(() =>
      expandRange("America/New_York", {
        startDate: "2026-03-08",
        endDate: "2026-03-08",
        weekdays: [7],
        dailyStart: "02:30",
        dailyEnd: "06:00",
      }),
    ).toThrow(DomainError);
  });

  it("supports overnight windows", () => {
    const windows = expandRange("America/New_York", {
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      weekdays: [1],
      dailyStart: "22:00",
      dailyEnd: "02:00",
    });
    expect(windows[0]?.start).toBe("2026-09-22T02:00:00Z");
    expect(windows[0]?.end).toBe("2026-09-22T06:00:00Z");
  });
});
